package com.fengmotion.server.creation.service;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.*;
import jakarta.annotation.PreDestroy;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.domain.SourceRenderRequest;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.service.ProjectWorktreeService;
import com.fengmotion.server.project.store.LocalStateStore;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Service
@RequiredArgsConstructor
@Slf4j
public class SourceRenderJobs {
    private static final String NAMESPACE = "source-render-request";
    private final LocalStateStore documents;
    private final ProjectSceneRepository scenes;
    private final ProjectWorktreeService worktrees;
    private final ProjectFilmRenderService renders;
    private final ProjectOperationLock operations;
    private final ObjectMapper json;
    private final Map<String, RenderTask> active = new ConcurrentHashMap<>();
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(20), new ThreadPoolExecutor.AbortPolicy());
    private boolean closed;

    public synchronized Job submit(String projectId, SourceRenderRequest request) {
        if (request == null) throw bad("缺少出片请求");
        request.validate();
        var saved = documents.find(NAMESPACE, request.requestId()).orElse(null);
        if (saved != null) {
            SourceRenderRequest original = json.convertValue(saved.data().path("request"), SourceRenderRequest.class);
            if (!projectId.equals(saved.projectId()) || !request.equals(original)) {
                throw new ApiException(HttpStatus.CONFLICT, "task_idempotency_conflict", "出片请求 ID 已用于其他内容");
            }
            return get(projectId, request.requestId());
        }
        if (closed) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "render_unavailable", "服务正在关闭");
        var activity = operations.participate(projectId);
        boolean submitted = false;
        try {
            var baseline = worktrees.read(projectId);
            if (baseline.version() != request.baseVersion()) throw conflict("scene_version_conflict", "版本已变化，请重新读取工作稿");
            if (!baseline.sourceHash().equals(request.sourceHash())) throw conflict("source_changed", "工作稿已变化，请重新读取后出片");
            if (active.values().stream().anyMatch(task -> projectId.equals(task.projectId)) || baseline.operationBusy()) {
                throw conflict("project_busy", "项目已有执行中的操作");
            }
            ObjectNode data = json.createObjectNode().put("state", "accepted").put("createdAt", Instant.now().toString());
            data.set("request", json.valueToTree(request));
            documents.put(NAMESPACE, request.requestId(), projectId, 0, data, false);
            RenderTask task = new RenderTask(projectId, request, activity);
            active.put(request.requestId(), task);
            try { executor.execute(task); submitted = true; }
            catch (RejectedExecutionException full) {
                active.remove(request.requestId());
                finish(request.requestId(), "failed", null, "render_queue_full", "出片队列已满，请稍后重试");
            }
            return get(projectId, request.requestId());
        } finally { if (!submitted) activity.close(); }
    }

    private void execute(RenderTask task) {
        String projectId = task.projectId;
        SourceRenderRequest request = task.request;
        synchronized (this) {
            if (active.get(request.requestId()) != task) return;
            task.worker = Thread.currentThread();
        }
        boolean locked = false;
        try {
            task.checkRunning();
            operations.acquire(projectId);
            locked = true;
            synchronized (this) {
                task.checkRunning();
                finish(request.requestId(), "running", null, null, null);
            }
            var rendered = renders.renderGuarded(projectId, request, task::stopped);
            var version = scenes.findVersion(projectId, rendered.version()).orElseThrow();
            finish(request.requestId(), "rendered", result(version), null, null);
        } catch (Exception failure) {
            Thread.interrupted();
            try {
                var committed = scenes.findVersionByRenderRequest(projectId, request.requestId());
                if (committed.isPresent()) finish(request.requestId(), "rendered", result(committed.get()), null, null);
                else if (task.stop != null) finishStopped(task);
                else finish(request.requestId(), "failed", null,
                        failure instanceof ApiException api ? api.getCode() : "render_failed", failure.getMessage());
            } catch (RuntimeException persistence) { log.error("出片状态保存失败 request={}", request.requestId(), persistence); }
        } finally {
            if (locked) operations.release(projectId);
            synchronized (this) {
                task.worker = null;
                active.remove(request.requestId(), task);
                task.activity.close();
                Thread.interrupted();
            }
        }
    }

    private synchronized void finish(String requestId, String state, JsonNode result, String code, String error) {
        var saved = documents.find(NAMESPACE, requestId).orElseThrow();
        ObjectNode next = saved.data().deepCopy();
        next.put("state", state).put("errorCode", code).put("error", error).put("updatedAt", Instant.now().toString());
        next.set("result", result);
        documents.put(NAMESPACE, requestId, saved.projectId(), saved.revision(), next, false);
    }

    public synchronized Job get(String projectId, String requestId) {
        try(var activity=operations.participate(projectId)) { return getActive(projectId,requestId); }
    }

    private Job getActive(String projectId,String requestId) {
        var saved = documents.find(NAMESPACE, requestId).filter(item -> projectId.equals(item.projectId())).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "not_found", "出片请求不存在"));
        JsonNode data = saved.data();
        String state = data.path("state").asText();
        if (!active.containsKey(requestId) && ("accepted".equals(state) || "running".equals(state))) {
            var committed = scenes.findVersionByRenderRequest(projectId, requestId);
            if (committed.isPresent()) {
                if (!Objects.equals(committed.get().film().path("sourceRenderRequest"), data.path("request"))) {
                    throw conflict("task_idempotency_conflict", "出片历史与请求身份不匹配");
                }
                finish(requestId, "rendered", result(committed.get()), null, null);
            } else finish(requestId, "interrupted", null, "render_interrupted", "上次出片已中断；工作稿仍保留，请核对后以新请求重试");
            return get(projectId, requestId);
        }
        return new Job(projectId, requestId, state, data.get("result"), data.path("errorCode").textValue(),
                data.path("error").textValue(), data.path("createdAt").asText(), data.path("updatedAt").asText(saved.updatedAt()));
    }

    public synchronized Job cancel(String projectId, String requestId) {
        var job = get(projectId, requestId);
        if (!"accepted".equals(job.state()) && !"running".equals(job.state())) return job;
        RenderTask task = active.get(requestId);
        if (task != null) {
            if (task.stop == null) task.stop = Stop.CANCELLED;
            if (task.worker == null) {
                finishStopped(task);
                executor.remove(task);
                active.remove(requestId, task);
                task.activity.close();
                return get(projectId, requestId);
            }
            task.worker.interrupt();
        }
        return job;
    }

    public java.util.List<Job> list(String projectId) {
        try (var activity = operations.participate(projectId)) {
            renders.requireProject(projectId);
            return documents.list(NAMESPACE, projectId, 100).stream().map(item -> get(projectId, item.id())).toList();
        }
    }

    private JsonNode result(ProjectSceneVersion version) {
        JsonNode film = version.film();
        ObjectNode result = json.createObjectNode().put("version", version.version())
                .put("artifactPath", version.artifactPath()).put("sourceHash", film.path("sourceHash").asText())
                .put("entry", film.path("entry").asText()).put("compositionId", film.path("compositionId").asText());
        for (String key : java.util.List.of("durationInFrames", "width", "height", "fps", "renderMs")) {
            result.set(key, film.path("output").path(key));
        }
        return result;
    }

    private static ApiException bad(String message) { return new ApiException(HttpStatus.BAD_REQUEST, "validation_error", message); }
    private static ApiException conflict(String code, String message) { return new ApiException(HttpStatus.CONFLICT, code, message); }

    private void finishStopped(RenderTask task) {
        boolean cancelled = task.stop == Stop.CANCELLED;
        finish(task.request.requestId(), cancelled ? "cancelled" : "interrupted", null,
                cancelled ? "render_cancelled" : "render_interrupted",
                cancelled ? "出片已取消" : "服务关闭，出片已中断；请核对工作稿后以新请求重试");
    }

    @PreDestroy
    public void close() {
        synchronized (this) {
            closed = true;
            for (RenderTask task : java.util.List.copyOf(active.values())) {
                if (task.stop == null) task.stop = Stop.SHUTDOWN;
                if (task.worker == null) {
                    try { finishStopped(task); }
                    catch (RuntimeException failure) { log.error("排队出片关闭状态保存失败 request={}", task.request.requestId(), failure); }
                    active.remove(task.request.requestId(), task);
                    task.activity.close();
                }
            }
            executor.shutdownNow();
        }
        try {
            if (!executor.awaitTermination(5, TimeUnit.SECONDS)) log.warn("部分出片线程尚未退出，已请求中断");
        } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
    }

    private enum Stop { CANCELLED, SHUTDOWN }

    private final class RenderTask implements Runnable {
        private final String projectId;
        private final SourceRenderRequest request;
        private final ProjectOperationLock.Lease activity;
        private volatile Stop stop;
        private Thread worker;

        private RenderTask(String projectId, SourceRenderRequest request, ProjectOperationLock.Lease activity) {
            this.projectId = projectId;
            this.request = request;
            this.activity = activity;
        }

        private boolean stopped() { return stop != null; }
        private void checkRunning() throws InterruptedException {
            if (stopped() || Thread.currentThread().isInterrupted()) throw new InterruptedException();
        }
        @Override public void run() { execute(this); }
    }

    public record Job(String projectId, String requestId, String state, JsonNode result,
                      String errorCode, String error, String createdAt, String updatedAt) { }
}
