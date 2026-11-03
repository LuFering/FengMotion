package com.fengmotion.server.task.api;

import java.time.Instant;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.domain.TaskEvent;
import com.fengmotion.server.task.service.ModifyTaskRunner;
import com.fengmotion.server.task.service.RenderTaskRunner;
import com.fengmotion.server.task.service.TaskRequestGuard;
import com.fengmotion.server.task.service.TaskRequestGuard.Route;
import com.fengmotion.server.task.service.TaskService;

import lombok.RequiredArgsConstructor;

/**
 * 任务端点：创建、查询、取消制作任务。
 *
 * <p>当前只接通「渲染」一种任务类型 —— 先让一条链路真正跑完
 * （创建 → 执行 → 出一条能播的视频 → 失败能看到真实原因），
 * 再横向扩其它类型。一次支持多种任务，往往哪种都没验证透。</p>
 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class TaskController {

    private final TaskService tasks;
    private final RenderTaskRunner renderRunner;
    private final ModifyTaskRunner modifyRunner;
    private final ObjectMapper json;

    /**
     * 创建制作任务。
     *
     * <p>按请求形状与 {@code kind} 分流（规则见 {@link TaskRequestGuard#route}）：</p>
     * <ul>
     *   <li>带 {@code film.scenes}、无 kind 或 kind=render → 直接渲染（已验收路径，形状不变）</li>
     *   <li>kind=modify → 修改执行流程</li>
     *   <li>其余 kind → {@code 400 unsupported_task_kind}，在创建阶段就拒绝，
     *       不让用户看到「已接受」再白等</li>
     * </ul>
     *
     * @param projectId 项目 ID
     * @param body      请求体
     * @return 202 与已创建的任务
     */
    @PostMapping("/projects/{projectId}/tasks")
    public TaskResponse create(@PathVariable String projectId, @RequestBody JsonNode body) {
        Route route = TaskRequestGuard.route(body);
        String prompt = body.path("prompt").asText("");

        // 用户勾了但本版做不到的约束，必须在受理时就以事件告知，不能静默失效
        List<String> warnings = TaskService.unenforcedWarnings(
                TaskRequestGuard.unenforcedConstraints(body));

        Task task;
        if (route == Route.RENDER) {
            task = tasks.submit(projectId, "render", prompt, body,
                    (t, progress) -> renderRunner.run(t, progress), warnings);
        } else {
            /* 修改流程：解析范围 → 读基线 → 生成方案 → 校验 → 渲染。
               生成器第一版是确定性规则而非模型，接口已按真实实现设计。 */
            task = tasks.submit(projectId, "modify", prompt, body,
                    (t, progress) -> modifyRunner.run(t, progress), warnings);
        }
        return TaskResponse.from(task);
    }

    /**
     * 列出项目的任务。
     *
     * @param projectId 项目 ID
     * @return 任务列表，最新在前
     */
    @GetMapping("/projects/{projectId}/tasks")
    public TaskListResponse list(@PathVariable String projectId) {
        List<TaskResponse> items = tasks.listByProject(projectId).stream().map(TaskResponse::from).toList();
        return new TaskListResponse(items);
    }

    /**
     * 查询单个任务。
     *
     * @param taskId 任务 ID
     * @return 任务详情
     */
    @GetMapping("/tasks/{taskId}")
    public TaskResponse get(@PathVariable String taskId) {
        return TaskResponse.from(tasks.get(taskId));
    }

    /**
     * 取消任务。
     *
     * @param taskId 任务 ID
     * @return 取消后的任务
     */
    @PostMapping("/tasks/{taskId}/cancel")
    public TaskResponse cancel(@PathVariable String taskId) {
        return TaskResponse.from(tasks.cancel(taskId));
    }

    /**
     * 任务事件（非流式快照，供测试与排查用）。
     *
     * @param taskId 任务 ID
     * @return 事件列表
     */
    @GetMapping("/tasks/{taskId}/events/snapshot")
    public EventListResponse eventsSnapshot(@PathVariable String taskId) {
        tasks.get(taskId);
        List<TaskEventResponse> items = tasks.eventsAfter(taskId, 0).stream()
                .map(TaskEventResponse::from).toList();
        return new EventListResponse(items);
    }

    /**
     * 任务响应。
     *
     * @param id           任务 ID
     * @param projectId    项目 ID
     * @param kind         类型
     * @param status       状态
     * @param prompt       用户要求
     * @param progress     进度 0~100
     * @param message      当前说明
     * @param artifactPath 产物相对路径；还没有时为空
     * @param errorCode    失败错误码
     * @param createdAt    创建时间
     * @param updatedAt    更新时间
     * @param finishedAt   结束时间
     */
    public record TaskResponse(String id, String projectId, String kind, String status,
                               String prompt, int progress, String message,
                               String artifactPath, String errorCode,
                               Instant createdAt, Instant updatedAt, Instant finishedAt) {
        /**
         * 由领域对象转换。
         *
         * @param task 任务
         * @return 响应体
         */
        static TaskResponse from(Task task) {
            return new TaskResponse(task.id(), task.projectId(), task.kind(), task.status(),
                    task.prompt(), task.progress(), task.message(), task.artifactPath(),
                    task.errorCode(), task.createdAt(), task.updatedAt(), task.finishedAt());
        }
    }

    /**
     * 任务列表响应。
     *
     * @param items 任务条目
     */
    public record TaskListResponse(List<TaskResponse> items) {
    }

    /**
     * 事件响应。
     *
     * @param id      事件 ID
     * @param seq     序号
     * @param kind    种类
     * @param status  该事件后的状态
     * @param message 说明
     * @param data    附加信息
     * @param at      时间
     */
    public record TaskEventResponse(String id, long seq, String kind, String status,
                                    String message, JsonNode data, Instant at) {
        /**
         * 由领域对象转换。
         *
         * @param event 事件
         * @return 响应体
         */
        static TaskEventResponse from(TaskEvent event) {
            return new TaskEventResponse(event.id(), event.seq(), event.kind(), event.status(),
                    event.message(), event.data(), event.at());
        }
    }

    /**
     * 事件列表响应。
     *
     * @param items 事件条目
     */
    public record EventListResponse(List<TaskEventResponse> items) {
    }
}
