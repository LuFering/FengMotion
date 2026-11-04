package com.fengmotion.server.workflow.api;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.workflow.service.WorkflowProjectService;

import lombok.RequiredArgsConstructor;

/**
 * 项目 × workflow-v5 的衔接端点。
 *
 * <p>只暴露两件事：读上下文状态、建立上下文（把用户原文落盘）。
 * 创作本身仍由 workflow-v5 的创作指令驱动，这里不代劳 ——
 * 接口少是刻意的，避免又长出一条与工作流并行的简化管线。</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/workflow")
@RequiredArgsConstructor
public class WorkflowProjectController {

    private final WorkflowProjectService service;

    /**
     * 读取项目的 workflow 创作上下文状态。
     *
     * @param projectId 项目 ID
     * @return 状态
     */
    @GetMapping
    public StateResponse state(@PathVariable String projectId) {
        var state = service.state(projectId);
        return new StateResponse(state.projectId(), state.directory(), state.initialized(),
                state.toolAvailable(), state.files(), state.promptLength(), state.passes());
    }

    /**
     * 建立 Prompt-first 创作上下文。
     *
     * <p>把用户原始需求<strong>逐字</strong>写入 {@code prompt.original.md}。
     * 已存在时不覆盖 —— 原文一旦被后来的摘要替换，创作依据就没了。</p>
     *
     * @param projectId 项目 ID
     * @param request   请求体
     * @return 建立后的状态
     */
    @PostMapping("/init")
    public StateResponse init(@PathVariable String projectId,
                              @RequestBody(required = false) InitRequest request) {
        String prompt = request == null ? null : request.prompt();
        var state = service.init(projectId, prompt);
        return new StateResponse(state.projectId(), state.directory(), state.initialized(),
                state.toolAvailable(), state.files(), state.promptLength(), state.passes());
    }

    /**
     * 建立上下文的请求。
     *
     * @param prompt 用户原始需求
     */
    public record InitRequest(String prompt) {
    }

    /**
     * 上下文状态响应。
     *
     * @param projectId    项目 ID
     * @param directory    项目目录
     * @param initialized  是否已有 prompt.original.md
     * @param toolAvailable workflow-v5 工具是否可用
     * @param files        已存在的 Prompt-first 文件
     * @param promptLength 原文长度；-1 表示读不到
     * @param passes       已完成渲染轮次；-1 表示读不到
     */
    public record StateResponse(String projectId, String directory, boolean initialized,
                                boolean toolAvailable, List<String> files,
                                long promptLength, int passes) {
    }
}
