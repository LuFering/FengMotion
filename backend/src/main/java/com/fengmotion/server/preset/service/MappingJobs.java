package com.fengmotion.server.preset.service;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.*;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.preset.domain.MappingJob;
import com.fengmotion.server.preset.domain.WorkflowPreset;
import com.fengmotion.server.preset.store.MappingJobStore;
import com.fengmotion.server.skill.store.SkillPackageRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Service
@RequiredArgsConstructor
@Slf4j
public class MappingJobs {
    private final WorkflowPresetService generator;
    private final MappingJobStore store;
    private final SkillPackageRepository packages;
    private final Map<String, Worker> workers = new ConcurrentHashMap<>();
    private final ExecutorService executor = new ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(20), new ThreadPoolExecutor.AbortPolicy());
    private boolean closed;

    /** 已结束作业的保留期；契约要求至少 24 小时。 */
    private static final java.time.Duration RETENTION = java.time.Duration.ofDays(7);

    @PostConstruct
    void recover() {
        for (MappingJob job : store.unfinished()) {
            store.update(job.id(), current -> current.finish("failed", null,
                    new MappingJob.Error("mapping_interrupted", "上次生成被中断，未保存草稿，请重新生成", List.of()), Instant.now()));
        }
        int purged = store.purgeFinishedBefore(Instant.now().minus(RETENTION));
        if (purged > 0) log.info("清理了 {} 条过期的生成预设作业", purged);
    }

    public synchronized MappingJob submit(String packageId, String skillPath) {
        generator.requireSkill(packageId, skillPath);
        var existing = store.active(packageId, skillPath);
        if (existing.isPresent()) throw inProgress(existing.get());
        if (!generator.modelAvailable()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "model_unavailable", "模型未接入，无法生成预设草稿");
        if (closed) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "mapping_unavailable", "服务正在关闭，请稍后重试");
        MappingJob job = new MappingJob(UUID.randomUUID().toString(), packageId, skillPath,
                "queued", null, null, null, null, null, null, null);
        try { store.insert(job); }
        catch (DataIntegrityViolationException conflict) {
            // 唯一索引兜底：另一个请求抢先插入了同一 SKILL.md 的作业
            var winner = store.active(packageId, skillPath);
            if (winner.isPresent()) throw inProgress(winner.get());
            throw conflict;
        }
        Worker worker = new Worker();
        workers.put(job.id(), worker);
        try { executor.submit(() -> execute(job, worker)); }
        catch (RejectedExecutionException full) {
            workers.remove(job.id());
            store.update(job.id(), current -> current.finish("failed", null,
                    new MappingJob.Error("mapping_queue_full", "生成队列已满，请稍后重新生成", List.of()), Instant.now()));
        }
        return get(job.id());
    }

    private void execute(MappingJob job, Worker worker) {
        worker.thread = Thread.currentThread();
        try {
            checkpoint(worker);
            generator.generate(job.skillPackageId(), job.skillPath(), new WorkflowPresetService.GenerationProgress() {
                @Override public void stage(String stage) {
                    checkpoint(worker);
                    store.update(job.id(), current -> current.stage(stage, Instant.now()));
                }

                @Override public void collected(PresetMappingPrompt.Built built) {
                    checkpoint(worker);
                    store.update(job.id(), current -> current.withContext(
                            new MappingJob.Context(built.files(), built.chars(), built.truncatedSources())));
                }

                @Override public void save(WorkflowPreset preset, Runnable persist) {
                    checkpoint(worker);
                    store.complete(job.id(), preset.id(), persist);
                }
            });
        } catch (Exception failure) {
            boolean interrupted = Thread.interrupted();
            boolean cancelled = worker.cancelRequested || interrupted || failure instanceof CancellationException;
            MappingJob.Error error = cancelled ? null : failure instanceof MappingInvalidException invalid
                    ? new MappingJob.Error(invalid.getCode(), invalid.getMessage(), invalid.getProblems())
                    : failure instanceof ApiException api
                    ? new MappingJob.Error(api.getCode(), api.getMessage(), List.of())
                    : new MappingJob.Error("mapping_failed", "生成预设失败，请重试或检查后端日志", List.of());
            try { store.update(job.id(), current -> current.finish(cancelled ? "cancelled" : "failed", null, error, Instant.now())); }
            catch (RuntimeException persistence) { log.error("生成作业收尾失败 job={}", job.id(), persistence); }
            if (!cancelled) log.warn("生成预设作业失败 job={} code={}", job.id(), error.code());
        } finally {
            worker.thread = null;
            workers.remove(job.id(), worker);
            Thread.interrupted();
        }
    }

    public MappingJob get(String jobId) {
        return store.find(jobId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "生成作业不存在"));
    }

    public List<MappingJob> list(String packageId, boolean activeOnly) {
        packages.findById(packageId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "Skill 包不存在"));
        return store.list(packageId, activeOnly);
    }

    public synchronized MappingJob cancel(String jobId) {
        MappingJob job = get(jobId);
        if (job.terminal()) return job;
        Worker worker = workers.get(jobId);
        if (worker != null) {
            worker.cancelRequested = true;
            Thread thread = worker.thread;
            if (thread != null && !"saving".equals(job.stage())) thread.interrupt();
        }
        if ("queued".equals(job.status())) {
            return store.update(jobId, current -> current.finish("cancelled", null, null, Instant.now()));
        }
        return get(jobId);
    }

    private static void checkpoint(Worker worker) {
        if (worker.cancelRequested || Thread.currentThread().isInterrupted()) throw new CancellationException("生成已取消");
    }

    private static ApiException inProgress(MappingJob job) {
        return new ApiException(HttpStatus.CONFLICT, "mapping_in_progress", "这个 Skill 已有生成中的作业", Map.of("jobId", job.id()));
    }

    @PreDestroy
    public synchronized void close() {
        closed = true;
        for (String jobId : List.copyOf(workers.keySet())) cancel(jobId);
        executor.shutdownNow();
    }

    private static final class Worker {
        volatile Thread thread;
        volatile boolean cancelRequested;
    }
}
