package com.fengmotion.server.task.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.domain.TaskEvent;
import com.fengmotion.server.task.store.TaskRepository;

/**
 * 任务状态机与取消语义。
 *
 * <p>用内存假仓储而不是真 SQLite：这里要验的是「状态迁移对不对」，
 * 不是「SQL 写得对不对」。持久化由仓储测试单独覆盖。</p>
 */
@DisplayName("任务状态机")
class TaskServiceTest {

    private final ObjectMapper json = new ObjectMapper();

    /**
     * 内存仓储：只实现被任务服务用到的部分。
     */
    private static final class MemoryRepo implements TaskRepository {
        final Map<String, Task> tasks = new LinkedHashMap<>();
        final Map<String, List<TaskEvent>> events = new LinkedHashMap<>();
        boolean cancelled = false;

        @Override public void save(Task task) { tasks.put(task.id(), task); }

        @Override public Optional<Task> findById(String id) { return Optional.ofNullable(tasks.get(id)); }

        @Override public List<Task> listByProject(String projectId, int limit) {
            return tasks.values().stream().filter(t -> t.projectId().equals(projectId)).toList();
        }

        @Override public boolean updateProgress(String id, String status, int progress, String message,
                                                String artifactPath, String errorCode, boolean finished) {
            Task old = tasks.get(id);
            if (old == null) return false;
            // 模拟 SQL 里的 status <> 'cancelled' 条件
            if (Task.STATUS_CANCELLED.equals(old.status())) return false;
            Task updated = new Task(old.id(), old.projectId(), old.kind(), status, old.prompt(),
                    old.request(), progress, message, artifactPath == null ? old.artifactPath() : artifactPath,
                    errorCode, old.createdAt(), Instant.now(), finished ? Instant.now() : null,
                    old.baseVersion(), old.resultVersion());
            tasks.put(id, updated);
            return true;
        }

        @Override public boolean cancel(String id, String message) {
            Task old = tasks.get(id);
            if (old == null || old.isTerminal()) return false;
            cancelled = true;
            tasks.put(id, new Task(old.id(), old.projectId(), old.kind(), Task.STATUS_CANCELLED,
                    old.prompt(), old.request(), old.progress(), message, old.artifactPath(),
                    old.errorCode(), old.createdAt(), Instant.now(), Instant.now(),
                    old.baseVersion(), old.resultVersion()));
            return true;
        }

        @Override public void updateVersions(String taskId, Long baseVersion, Long resultVersion) {
            Task old = tasks.get(taskId);
            if (old == null) return;
            tasks.put(taskId, new Task(old.id(), old.projectId(), old.kind(), old.status(),
                    old.prompt(), old.request(), old.progress(), old.message(), old.artifactPath(),
                    old.errorCode(), old.createdAt(), old.updatedAt(), old.finishedAt(),
                    baseVersion, resultVersion));
        }

        @Override public TaskEvent appendEvent(TaskEvent event) {
            List<TaskEvent> list = events.computeIfAbsent(event.taskId(), k -> new ArrayList<>());
            TaskEvent withSeq = new TaskEvent(event.id() == null ? "e" + list.size() : event.id(),
                    event.taskId(), list.size() + 1, event.kind(), event.status(), event.message(),
                    event.data(), event.at());
            list.add(withSeq);
            return withSeq;
        }

        @Override public List<TaskEvent> findEventsAfter(String taskId, long afterSeq) {
            return events.getOrDefault(taskId, List.of()).stream().filter(e -> e.seq() > afterSeq).toList();
        }
    }

    /** 直接执行回调的事务模板替身（不需要真事务）。 */
    private static TransactionTemplate directTx() {
        return new TransactionTemplate() {
            @Override public <T> T execute(TransactionCallback<T> action) {
                return action.doInTransaction(null);
            }
            @Override public void executeWithoutResult(java.util.function.Consumer<org.springframework.transaction.TransactionStatus> action) {
                action.accept(null);
            }
        };
    }

    private ProjectRepository projectRepo(String projectId) {
        return new ProjectRepository() {
            @Override public void save(Project project) { }
            @Override public Optional<Project> findById(String id) {
                return projectId.equals(id)
                        ? Optional.of(new Project(projectId, "测试项目", "explainer", null, "/tmp", Instant.now()))
                        : Optional.empty();
            }
        };
    }

    @Test
    @DisplayName("提交后任务落库为 queued，并写下 accepted 事件")
    void submitRecordsQueuedAndAccepted() {
        MemoryRepo repo = new MemoryRepo();
        var service = new TaskService(repo, projectRepo("p1"), directTx(), json);

        Task task = service.submit("p1", "render", "做一条片子", json.createObjectNode(),
                (t, progress) -> null);

        assertEquals(Task.STATUS_QUEUED, repo.tasks.get(task.id()).status());
        List<TaskEvent> events = repo.events.get(task.id());
        assertEquals(TaskEvent.KIND_ACCEPTED, events.get(0).kind());
    }

    @Test
    @DisplayName("警告事件与 accepted 同事务写入，且排在执行事件之前")
    void warningsAreWrittenBeforeExecution() {
        MemoryRepo repo = new MemoryRepo();
        var service = new TaskService(repo, projectRepo("p1"), directTx(), json);

        List<String> warnings = TaskService.unenforcedWarnings(List.of("preserveCamera"));
        Task task = service.submit("p1", "render", "做一条片子", json.createObjectNode(),
                (t, progress) -> null, warnings);

        List<TaskEvent> events = repo.events.get(task.id());
        // 受理时就已写好，不依赖执行线程的调度顺序
        assertEquals(TaskEvent.KIND_ACCEPTED, events.get(0).kind());
        assertEquals(TaskEvent.KIND_WARNING, events.get(1).kind());
        assertTrue(events.get(1).message().contains("preserveCamera"));
        assertEquals(Task.STATUS_QUEUED, events.get(1).status());
    }

    @Test
    @DisplayName("执行器登记过产物后再失败，产物路径仍保留在任务上")
    void failureKeepsRegisteredArtifact() throws Exception {
        MemoryRepo repo = new MemoryRepo();
        var service = new TaskService(repo, projectRepo("p1"), directTx(), json);

        // 模拟「视频已生成、提交场景时发现版本冲突」
        Task task = service.submit("p1", "modify", "改", json.createObjectNode(),
                (t, progress) -> {
                    service.registerArtifact(t.id(), "renders/conflict.mp4");
                    throw new ApiException(org.springframework.http.HttpStatus.CONFLICT,
                            "scene_version_conflict", "版本冲突");
                }, List.of());

        waitForTerminal(repo, task.id());
        Task failed = repo.tasks.get(task.id());
        assertEquals(Task.STATUS_FAILED, failed.status());
        assertEquals("renders/conflict.mp4", failed.artifactPath(),
                "失败但确实产出过文件，路径不能丢");
        assertEquals("scene_version_conflict", failed.errorCode());
    }

    @Test
    @DisplayName("没有登记产物的失败任务，产物路径为空")
    void failureWithoutArtifactHasNoPath() throws Exception {
        MemoryRepo repo = new MemoryRepo();
        var service = new TaskService(repo, projectRepo("p1"), directTx(), json);

        Task task = service.submit("p1", "modify", "改", json.createObjectNode(),
                (t, progress) -> {
                    throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST,
                            "validation_error", "坏请求");
                }, List.of());

        waitForTerminal(repo, task.id());
        assertNull(repo.tasks.get(task.id()).artifactPath());
    }

    @Test
    @DisplayName("没有未生效约束时不写警告事件")
    void noWarningsWhenNothingUnenforced() throws Exception {
        MemoryRepo repo = new MemoryRepo();
        var service = new TaskService(repo, projectRepo("p1"), directTx(), json);

        Task task = service.submit("p1", "render", "做一条片子", json.createObjectNode(),
                (t, progress) -> null, List.of());

        /* 必须先等任务进终态再读事件：submit 是异步执行的，
           后台线程还在往 events 里追加时去 stream 会抛
           ConcurrentModificationException —— 这条断言曾偶发失败。 */
        waitForTerminal(repo, task.id());
        List<TaskEvent> events = List.copyOf(repo.events.get(task.id()));
        assertTrue(events.stream().noneMatch(e -> TaskEvent.KIND_WARNING.equals(e.kind())));
    }

    @Test
    @DisplayName("执行成功后状态变 completed 并记录产物路径")
    void successMarksCompletedWithArtifact() throws Exception {
        MemoryRepo repo = new MemoryRepo();
        var service = new TaskService(repo, projectRepo("p1"), directTx(), json);

        Task task = service.submit("p1", "render", "", json.createObjectNode(),
                (t, progress) -> "renders/out.mp4");

        waitForTerminal(repo, task.id());
        Task done = repo.tasks.get(task.id());
        assertEquals(Task.STATUS_COMPLETED, done.status());
        assertEquals("renders/out.mp4", done.artifactPath());
        assertEquals(100, done.progress());
        assertNotNull(done.finishedAt());
    }

    @Test
    @DisplayName("执行抛异常时状态变 failed，并保留原始错误信息")
    void failureKeepsOriginalMessage() throws Exception {
        MemoryRepo repo = new MemoryRepo();
        var service = new TaskService(repo, projectRepo("p1"), directTx(), json);

        Task task = service.submit("p1", "render", "", json.createObjectNode(),
                (t, progress) -> {
                    throw new IllegalStateException("ffmpeg 挂了");
                });

        waitForTerminal(repo, task.id());
        Task failed = repo.tasks.get(task.id());
        assertEquals(Task.STATUS_FAILED, failed.status());
        // 用户需要知道为什么没做出来，不能只说「执行失败」
        assertEquals("ffmpeg 挂了", failed.message());
    }

    @Test
    @DisplayName("取消执行中的任务：状态变 cancelled，且后续不会被改回完成")
    void cancelSticksAndCannotBeOverwritten() throws Exception {
        MemoryRepo repo = new MemoryRepo();
        var service = new TaskService(repo, projectRepo("p1"), directTx(), json);
        CountDownLatch started = new CountDownLatch(1);

        Task task = service.submit("p1", "render", "", json.createObjectNode(),
                (t, progress) -> {
                    started.countDown();
                    // 等一段足够长的时间，好让取消先发生
                    Thread.sleep(2000);
                    return "renders/late.mp4";
                });

        assertTrue(started.await(5, TimeUnit.SECONDS), "执行应已开始");
        service.cancel(task.id());

        // 等执行线程走完，确认它没有把 cancelled 覆盖成 completed
        Thread.sleep(1200);
        assertEquals(Task.STATUS_CANCELLED, repo.tasks.get(task.id()).status());
        assertNull(repo.tasks.get(task.id()).artifactPath(), "取消后不该登记产物");
    }

    @Test
    @DisplayName("已结束的任务不能再取消")
    void cannotCancelFinishedTask() throws Exception {
        MemoryRepo repo = new MemoryRepo();
        var service = new TaskService(repo, projectRepo("p1"), directTx(), json);

        Task task = service.submit("p1", "render", "", json.createObjectNode(),
                (t, progress) -> null);
        waitForTerminal(repo, task.id());

        // 把已完成改成「已取消」会让用户以为白做了
        assertThrows(ApiException.class, () -> service.cancel(task.id()));
        assertEquals(Task.STATUS_COMPLETED, repo.tasks.get(task.id()).status());
    }

    @Test
    @DisplayName("项目不存在时提交被拒绝")
    void submitRejectsUnknownProject() {
        MemoryRepo repo = new MemoryRepo();
        var service = new TaskService(repo, projectRepo("p1"), directTx(), json);

        assertThrows(ApiException.class,
                () -> service.submit("不存在的项目", "render", "", json.createObjectNode(), (t, p) -> null));
    }

    /**
     * 等任务进入终态。
     *
     * @param repo   仓储
     * @param taskId 任务 ID
     */
    private static void waitForTerminal(MemoryRepo repo, String taskId) throws InterruptedException {
        for (int i = 0; i < 100; i++) {
            Task task = repo.tasks.get(taskId);
            if (task != null && task.isTerminal()) {
                return;
            }
            Thread.sleep(30);
        }
        throw new AssertionError("任务未在预期时间内进入终态");
    }
}
