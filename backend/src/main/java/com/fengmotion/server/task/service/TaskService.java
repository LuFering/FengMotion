package com.fengmotion.server.task.service;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.domain.TaskEvent;
import com.fengmotion.server.task.store.TaskRepository;

import lombok.extern.slf4j.Slf4j;

/**
 * 任务的创建、执行、取消与查询。
 *
 * <p><strong>执行在独立线程</strong>：渲染可能跑几分钟，不能占着 HTTP 请求线程。
 * 但任务一提交就必须返回 ID，让前端能订阅事件流。</p>
 *
 * <p><strong>状态只在仓储层落库</strong>：内存里只保留「哪个任务在跑、怎么取消它」，
 * 任务本身的进度与结果一律读库。这样服务重启后历史还在，
 * 而不会出现「内存说有、库里没有」的分裂。</p>
 *
 * <p><strong>取消是协作式的</strong>：置位内存里的取消标记并打断线程，由执行器
 * 在每个阶段检查。强制杀不可行 —— 渲染在子进程里，得由执行器自己负责收尾。</p>
 */
@Service
@Slf4j
public class TaskService {

    /** 单项目最多保留的历史任务查询数量。 */
    private static final int LIST_LIMIT = 50;

    private final TaskRepository tasks;
    private final ProjectRepository projects;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;

    /** 执行线程池：渲染是 CPU 密集的，限制并发避免同时起多个 Chromium 打爆内存。 */
    private final ExecutorService executor = Executors.newFixedThreadPool(2, runnable -> {
        Thread thread = new Thread(runnable, "task-worker");
        thread.setDaemon(true);
        return thread;
    });

    /** 正在执行的任务：taskId → 控制句柄。 */
    private final Map<String, Running> running = new ConcurrentHashMap<>();

    public TaskService(TaskRepository tasks, ProjectRepository projects,
                       TransactionTemplate transactions, ObjectMapper json) {
        this.tasks = tasks;
        this.projects = projects;
        this.transactions = transactions;
        this.json = json;
    }

    /** 一个正在执行的任务的控制句柄。 */
    private static final class Running {
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        volatile Future<?> future;
        volatile Thread thread;
    }

    /**
     * 提交任务的具体执行逻辑。
     *
     * <p>由各任务类型实现（渲染、修改…）。实现应当周期性调用
     * {@code isCancelled} 检查取消，并在产出后调用 {@code reportArtifact}。</p>
     */
    public interface TaskRunner {
        /**
         * 执行任务。
         *
         * @param task     任务快照
         * @param progress 进度与取消的反馈通道
         * @return 产物相对项目目录的路径；没有产物时返回 null
         * @throws Exception 执行失败时抛出，消息会原样展示给用户
         */
        String run(Task task, Progress progress) throws Exception;
    }

    /** 执行器用来回报进度、检查取消的通道。 */
    public interface Progress {
        /**
         * 报告进度。
         *
         * @param percent 0~100
         * @param message 当前在做什么
         */
        void report(int percent, String message);

        /**
         * 是否已被取消。
         *
         * @return 已取消返回 true，执行器应尽快退出
         */
        boolean isCancelled();
    }

    /**
     * 创建并开始执行一个任务。
     *
     * @param projectId 项目 ID
     * @param kind      任务类型
     * @param prompt    用户要求（人可读）
     * @param request   完整请求体
     * @param runner    执行逻辑
     * @return 已落库的任务（状态为 queued）
     */
    public Task submit(String projectId, String kind, String prompt, JsonNode request, TaskRunner runner) {
        return submit(projectId, kind, prompt, request, runner, List.of());
    }

    /**
     * 创建并开始执行一个任务，同时在受理时就写入警告事件。
     *
     * <p>警告必须与「已接受」在同一事务里写。放到 {@code submit} 返回之后再由
     * 调用方补写会有竞态：执行线程可能已经跑完并落了 error 事件，
     * 警告就插在错误之后、甚至写进已终态的任务，用户看到的顺序是错的。
     * 用户设置的约束是否生效，属于「受理时就必须说清」的信息。</p>
     *
     * @param projectId    项目 ID
     * @param kind         任务类型
     * @param prompt       用户要求
     * @param request      完整请求体
     * @param runner       执行逻辑
     * @param warnings     受理时就要告知用户的警告正文；为空则不写
     * @return 已落库的任务（状态为 queued）
     */
    public Task submit(String projectId, String kind, String prompt, JsonNode request,
                       TaskRunner runner, List<String> warnings) {
        if (projects.findById(projectId).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在");
        }

        Instant now = Instant.now();
        Task task = new Task(UUID.randomUUID().toString(), projectId, kind, Task.STATUS_QUEUED,
                prompt == null ? "" : prompt, request, 0, "已接受，等待开始", null, null, now, now, null);

        // 任务与「已接受」事件在同一事务里写：只写下一个就是数据不一致
        transactions.executeWithoutResult(status -> {
            tasks.save(task);
            tasks.appendEvent(new TaskEvent(UUID.randomUUID().toString(), task.id(), 0,
                    TaskEvent.KIND_ACCEPTED, Task.STATUS_QUEUED, "已接受，等待开始", null, now));
            if (warnings != null) {
                for (String warning : warnings) {
                    tasks.appendEvent(new TaskEvent(UUID.randomUUID().toString(), task.id(), 0,
                            TaskEvent.KIND_WARNING, Task.STATUS_QUEUED, warning, null, now));
                }
            }
        });

        Running control = new Running();
        running.put(task.id(), control);
        control.future = executor.submit(() -> execute(task, runner, control));
        return task;
    }

    /**
     * 把「未生效约束」翻译成警告正文。
     *
     * @param names 约束名
     * @return 可直接展示并落库的警告句；没有时为空列表
     */
    public static List<String> unenforcedWarnings(List<String> names) {
        if (names == null || names.isEmpty()) {
            return List.of();
        }
        return List.of("以下约束本版尚未实现，任务不会按它们执行：" + String.join("、", names));
    }

    /**
     * 实际执行一个任务。
     *
     * @param task    任务快照
     * @param runner  执行逻辑
     * @param control 控制句柄
     */
    private void execute(Task task, TaskRunner runner, Running control) {
        control.thread = Thread.currentThread();
        String taskId = task.id();

        Progress progress = new Progress() {
            @Override
            public void report(int percent, String message) {
                if (control.cancelled.get()) {
                    return;
                }
                // 进度落库失败不该中断执行：产片比进度条重要
                try {
                    transactions.executeWithoutResult(status -> {
                        tasks.updateProgress(taskId, Task.STATUS_BUILDING,
                                Math.max(0, Math.min(100, percent)), message, null, null, false);
                        ObjectNode data = json.createObjectNode().put("progress", percent);
                        tasks.appendEvent(new TaskEvent(UUID.randomUUID().toString(), taskId, 0,
                                TaskEvent.KIND_PROGRESS, Task.STATUS_BUILDING, message, data, Instant.now()));
                    });
                } catch (RuntimeException ignored) {
                    log.warn("任务 {} 进度落库失败", taskId);
                }
            }

            @Override
            public boolean isCancelled() {
                return control.cancelled.get();
            }
        };

        try {
            markRunning(taskId);
            String artifact = runner.run(task, progress);

            if (control.cancelled.get()) {
                // 取消已经落库，这里不再改状态
                return;
            }
            finish(taskId, artifact);
        } catch (Exception failure) {
            if (control.cancelled.get()) {
                return;
            }
            fail(taskId, failure);
        } finally {
            running.remove(taskId);
        }
    }

    /**
     * 把任务标成执行中。
     *
     * @param taskId 任务 ID
     */
    private void markRunning(String taskId) {
        transactions.executeWithoutResult(status -> {
            boolean updated = tasks.updateProgress(taskId, Task.STATUS_RUNNING, 0, "开始执行", null, null, false);
            if (!updated) {
                // 已被取消：抛出让 execute 走取消分支
                throw new IllegalStateException("任务已被取消");
            }
            tasks.appendEvent(new TaskEvent(UUID.randomUUID().toString(), taskId, 0,
                    TaskEvent.KIND_PROGRESS, Task.STATUS_RUNNING, "开始执行", null, Instant.now()));
        });
    }

    /**
     * 标记任务成功。
     *
     * @param taskId   任务 ID
     * @param artifact 产物相对路径
     */
    private void finish(String taskId, String artifact) {
        transactions.executeWithoutResult(status -> {
            tasks.updateProgress(taskId, Task.STATUS_COMPLETED, 100, "已完成", artifact, null, true);
            ObjectNode data = json.createObjectNode();
            if (artifact != null) {
                data.put("artifactPath", artifact);
            }
            tasks.appendEvent(new TaskEvent(UUID.randomUUID().toString(), taskId, 0,
                    TaskEvent.KIND_COMPLETE, Task.STATUS_COMPLETED, "已完成", data, Instant.now()));
        });
    }

    /**
     * 标记任务失败。
     *
     * <p>失败原因原样带出：用户需要知道「为什么没做出来」，
     * 而不是一句「执行失败」。</p>
     *
     * @param taskId  任务 ID
     * @param failure 异常
     */
    private void fail(String taskId, Exception failure) {
        String message = failure.getMessage() == null ? failure.getClass().getSimpleName() : failure.getMessage();
        String code = failure instanceof ApiException api ? api.getCode() : "task_failed";
        try {
            transactions.executeWithoutResult(status -> {
                tasks.updateProgress(taskId, Task.STATUS_FAILED, 0, message, null, code, true);
                ObjectNode data = json.createObjectNode().put("errorCode", code);
                tasks.appendEvent(new TaskEvent(UUID.randomUUID().toString(), taskId, 0,
                        TaskEvent.KIND_ERROR, Task.STATUS_FAILED, message, data, Instant.now()));
            });
        } catch (RuntimeException nested) {
            log.error("任务 {} 失败状态落库失败", taskId, nested);
        }
    }

    /**
     * 取消任务。
     *
     * @param taskId 任务 ID
     * @return 取消后的任务
     */
    public Task cancel(String taskId) {
        Task task = requireTask(taskId);
        if (task.isTerminal()) {
            // 已完成/已失败的任务不能再取消：把它改成「已取消」会让用户以为白做了
            throw new ApiException(HttpStatus.CONFLICT, "task_already_finished",
                    "任务已结束，不能取消");
        }

        Running control = running.get(taskId);
        if (control != null) {
            control.cancelled.set(true);
            Future<?> future = control.future;
            if (future != null) {
                future.cancel(true);
            }
            Thread thread = control.thread;
            if (thread != null) {
                thread.interrupt();
            }
        }

        transactions.executeWithoutResult(status -> {
            if (tasks.cancel(taskId, "用户取消")) {
                tasks.appendEvent(new TaskEvent(UUID.randomUUID().toString(), taskId, 0,
                        TaskEvent.KIND_CANCELLED, Task.STATUS_CANCELLED, "用户取消", null, Instant.now()));
            }
        });
        return requireTask(taskId);
    }

    /**
     * 查询单个任务。
     *
     * @param taskId 任务 ID
     * @return 任务
     */
    public Task get(String taskId) {
        return requireTask(taskId);
    }

    /**
     * 列出项目的任务。
     *
     * @param projectId 项目 ID
     * @return 任务列表，最新在前
     */
    public List<Task> listByProject(String projectId) {
        return tasks.listByProject(projectId, LIST_LIMIT);
    }

    /**
     * 读取任务事件（断线重连补发用）。
     *
     * @param taskId   任务 ID
     * @param afterSeq 只取该序号之后
     * @return 事件列表
     */
    public List<TaskEvent> eventsAfter(String taskId, long afterSeq) {
        return tasks.findEventsAfter(taskId, afterSeq);
    }

    /**
     * 取任务，不存在时抛 404。
     *
     * @param taskId 任务 ID
     * @return 任务
     */
    private Task requireTask(String taskId) {
        return tasks.findById(taskId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "任务不存在"));
    }
}
