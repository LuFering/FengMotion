package com.fengmotion.server.render.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.store.ProjectRepository;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class LivePreviewService {
    private final ProjectRepository projects;
    private final ProjectFilmConfig configs;
    private final LivePreviewLauncher launcher;
    private final Duration startupTimeout;
    private final Duration idleTimeout;
    private final Clock clock;
    private final Map<String, Session> sessions = new HashMap<>();
    private final Semaphore startupSlot = new Semaphore(1, true);
    private final ScheduledExecutorService reaper = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "live-preview-reaper");
        thread.setDaemon(true);
        return thread;
    });
    private boolean closed;

    @Autowired
    public LivePreviewService(ProjectRepository projects, ProjectFilmConfig configs, LivePreviewLauncher launcher,
            @Value("${fengmotion.live-preview.start-timeout-seconds:60}") long startupSeconds,
            @Value("${fengmotion.live-preview.idle-timeout-seconds:600}") long idleSeconds) {
        this(projects, configs, launcher, Duration.ofSeconds(Math.max(1, startupSeconds)),
                Duration.ofSeconds(Math.max(1, idleSeconds)), Clock.systemUTC());
    }

    LivePreviewService(ProjectRepository projects, ProjectFilmConfig configs, LivePreviewLauncher launcher,
                       Duration startupTimeout, Duration idleTimeout, Clock clock) {
        this.projects = projects;
        this.configs = configs;
        this.launcher = launcher;
        this.startupTimeout = startupTimeout;
        this.idleTimeout = idleTimeout;
        this.clock = clock;
    }

    @PostConstruct
    void scheduleCleanup() {
        reaper.scheduleWithFixedDelay(() -> {
            try { reap(); }
            catch (RuntimeException failure) { log.warn("实时预览回收失败", failure); }
        }, 30, 30, TimeUnit.SECONDS);
    }

    public Status start(String projectId) {
        Project project = requireProject(projectId);
        reap();
        Session session;
        boolean owner = false;
        synchronized (sessions) {
            if (closed) throw stopping();
            session = sessions.get(projectId);
            if (session == null) {
                session = new Session(clock.instant());
                sessions.put(projectId, session);
                owner = true;
            }
            session.lastUsed = clock.instant();
        }
        if (owner) launch(projectId, project, session);
        try { return session.ready.join(); }
        catch (CompletionException failure) {
            if (failure.getCause() instanceof RuntimeException cause) throw cause;
            throw LivePreviewProcess.unavailable("预览启动失败");
        }
    }

    private void launch(String projectId, Project project, Session session) {
        boolean acquired = false;
        LivePreviewProcess process = null;
        long deadline = System.nanoTime() + startupTimeout.toNanos();
        try {
            Path root = root(project);
            var config = config(root);
            while (!(acquired = startupSlot.tryAcquire(50, TimeUnit.MILLISECONDS))) {
                requireActive(projectId, session);
                if (System.nanoTime() >= deadline) throw startTimeout();
            }
            requireActive(projectId, session);
            process = launcher.launch(root, config);
            process.logExit(projectId);
            synchronized (sessions) {
                requireActive(projectId, session);
                session.process = process;
            }
            String url = process.awaitReady(Duration.ofNanos(Math.max(0, deadline - System.nanoTime())));
            Session evicted = null;
            synchronized (sessions) {
                requireActive(projectId, session);
                if (sessions.values().stream().filter(item -> item.status != null).count() >= 3) {
                    String oldest = sessions.entrySet().stream().filter(entry -> entry.getValue().status != null)
                            .min(Comparator.comparing(entry -> entry.getValue().lastUsed)).orElseThrow().getKey();
                    evicted = detach(oldest, LivePreviewProcess.unavailable("预览已回收，请重新打开"));
                }
            }
            stopProcess(evicted);
            synchronized (sessions) {
                requireActive(projectId, session);
                session.status = new Status(projectId, "ready", url, config.compositionId(), clock.instant());
                session.ready.complete(session.status);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            failStartup(projectId, session, LivePreviewProcess.unavailable("预览启动被中断"));
        } catch (RuntimeException failure) {
            failStartup(projectId, session, failure);
        } finally {
            if (session.status == null && process != null) process.stop();
            if (acquired) startupSlot.release();
        }
    }

    private void requireActive(String projectId, Session session) {
        synchronized (sessions) {
            if (closed) throw stopping();
            if (sessions.get(projectId) != session) throw LivePreviewProcess.unavailable("预览启动已停止");
        }
    }

    private void failStartup(String projectId, Session session, RuntimeException failure) {
        synchronized (sessions) {
            session.ready.completeExceptionally(failure);
            sessions.remove(projectId, session);
        }
    }

    public Status get(String projectId) {
        requireProject(projectId);
        reap();
        Session session;
        Status status;
        synchronized (sessions) {
            session = sessions.get(projectId);
            if (session == null || session.status == null) return stopped(projectId);
            status = session.status;
        }
        boolean healthy = session.process.healthy(status.url());
        Session removed = null;
        synchronized (sessions) {
            if (sessions.get(projectId) != session) return stopped(projectId);
            if (!session.process.alive()) {
                removed = detach(projectId, LivePreviewProcess.unavailable("预览进程已退出"));
            } else {
                if (!healthy) log.debug("实时预览暂未响应，保留运行中进程 project={}", projectId);
                return status;
            }
        }
        stopProcess(removed);
        return stopped(projectId);
    }

    public void stop(String projectId) {
        requireProject(projectId);
        Session removed;
        synchronized (sessions) { removed = detach(projectId, LivePreviewProcess.unavailable("预览已停止，请重新打开")); }
        stopProcess(removed);
    }

    void reap() {
        List<Session> removed = new ArrayList<>();
        Instant cutoff = clock.instant().minus(idleTimeout);
        Map<String, Session> copy;
        synchronized (sessions) { copy = new HashMap<>(sessions); }
        for (var entry : copy.entrySet()) {
            boolean missing = projects.findById(entry.getKey()).isEmpty();
            synchronized (sessions) {
                Session session = entry.getValue();
                if (sessions.get(entry.getKey()) != session) continue;
                if (missing || (session.status != null
                        && (session.lastUsed.isBefore(cutoff) || !session.process.alive()))) {
                    removed.add(detach(entry.getKey(), LivePreviewProcess.unavailable("预览已回收，请重新打开")));
                }
            }
        }
        removed.forEach(LivePreviewService::stopProcess);
    }

    private Project requireProject(String projectId) {
        return projects.findById(projectId).orElseThrow(() -> {
            Session removed;
            synchronized (sessions) { removed = detach(projectId, LivePreviewProcess.unavailable("项目已删除")); }
            stopProcess(removed);
            return new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在");
        });
    }

    private static Path root(Project project) {
        if (project.rootPath() == null || project.rootPath().isBlank()) throw LivePreviewProcess.unavailable("项目没有源码目录");
        try { return Path.of(project.rootPath()).toRealPath(); }
        catch (IOException | IllegalArgumentException failure) { throw LivePreviewProcess.unavailable("项目源码目录不存在或不可读"); }
    }

    private ProjectFilmConfig.FilmConfig config(Path root) {
        try {
            var config = configs.read(root);
            if (config.shotTimeline() != null) throw LivePreviewProcess.unavailable("当前预览壳需要真实 entry；镜头装配工程暂不支持实时预览");
            Path entry = Path.of(config.entry());
            Path resolved = root.resolve(entry).normalize();
            if (entry.isAbsolute() || !resolved.startsWith(root) || !Files.isRegularFile(resolved)
                    || !resolved.toRealPath().startsWith(root)) throw LivePreviewProcess.unavailable("工程入口必须位于项目目录内");
            return config;
        } catch (ApiException failure) {
            throw LivePreviewProcess.unavailable(failure.getMessage());
        } catch (IOException | IllegalArgumentException failure) {
            throw LivePreviewProcess.unavailable("工程入口不可读");
        }
    }

    private Session detach(String projectId, RuntimeException failure) {
        Session session = sessions.remove(projectId);
        if (session != null) session.ready.completeExceptionally(failure);
        return session;
    }

    private static void stopProcess(Session session) {
        if (session != null && session.process != null) session.process.stop();
    }

    private static ApiException stopping() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "live_preview_stopping", "后端正在关闭，请稍后重试");
    }

    private static ApiException startTimeout() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "live_preview_start_timeout", "等待预览启动超时，请重试");
    }

    @PreDestroy
    public void close() {
        reaper.shutdownNow();
        List<Session> removed = new ArrayList<>();
        synchronized (sessions) {
            closed = true;
            for (String projectId : sessions.keySet().stream().toList()) removed.add(detach(projectId, stopping()));
        }
        removed.forEach(LivePreviewService::stopProcess);
    }

    private static Status stopped(String projectId) { return new Status(projectId, "stopped", null, null, null); }

    public record Status(String projectId, String status, String url, String compositionId, Instant startedAt) { }

    private static final class Session {
        volatile LivePreviewProcess process;
        volatile Status status;
        final CompletableFuture<Status> ready = new CompletableFuture<>();
        Instant lastUsed;

        Session(Instant startedAt) {
            this.lastUsed = startedAt;
        }
    }
}
