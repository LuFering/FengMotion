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
import com.fengmotion.server.project.service.ProjectOperationLock;
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
    private final ProjectOperationLock operations;
    private com.fengmotion.server.project.store.ProjectSceneRepository scenes;
    private com.fengmotion.server.project.service.ProjectSourceSnapshots snapshots;
    private final Map<String, Session> sessions = new HashMap<>();
    private final java.util.Set<Session> stopping = java.util.concurrent.ConcurrentHashMap.newKeySet();
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
            @Value("${fengmotion.live-preview.idle-timeout-seconds:600}") long idleSeconds,
            ProjectOperationLock operations,
            com.fengmotion.server.project.store.ProjectSceneRepository scenes,
            com.fengmotion.server.project.service.ProjectSourceSnapshots snapshots) {
        this(projects, configs, launcher, Duration.ofSeconds(Math.max(1, startupSeconds)),
                Duration.ofSeconds(Math.max(1, idleSeconds)), Clock.systemUTC(), operations);
        this.scenes=scenes;
        this.snapshots=snapshots;
    }

    LivePreviewService(ProjectRepository projects, ProjectFilmConfig configs, LivePreviewLauncher launcher,
                       Duration startupTimeout, Duration idleTimeout, Clock clock) {
        this(projects, configs, launcher, startupTimeout, idleTimeout, clock, new ProjectOperationLock());
    }

    LivePreviewService(ProjectRepository projects, ProjectFilmConfig configs, LivePreviewLauncher launcher,
                       Duration startupTimeout, Duration idleTimeout, Clock clock, ProjectOperationLock operations) {
        this.projects = projects;
        this.configs = configs;
        this.launcher = launcher;
        this.startupTimeout = startupTimeout;
        this.idleTimeout = idleTimeout;
        this.clock = clock;
        this.operations = operations;
    }

    @PostConstruct
    void scheduleCleanup() {
        reaper.scheduleWithFixedDelay(() -> {
            try { reap(); }
            catch (RuntimeException failure) { log.warn("实时预览回收失败", failure); }
        }, 30, 30, TimeUnit.SECONDS);
    }

    public Status start(String projectId) {
        return start(projectId,null);
    }

    public Status start(String projectId,Long version) {
        try (var admission = operations.participate(projectId)) {
            return startActive(projectId,version);
        }
    }

    private Status startActive(String projectId,Long version) {
        Project project = requireProject(projectId);
        String key=key(projectId,version);
        reap();
        String signature=version==null?configurationSignature(project):"version:"+version;
        Session session;
        boolean owner = false;
        synchronized (sessions) {
            if (closed) throw stopping();
            session = sessions.get(key);
            if (session == null || (session.status!=null && !signature.equals(session.configuration))) {
                Session previous=session;
                session = new Session(clock.instant(), operations.participate(projectId),projectId,version);
                session.configuration=signature;
                session.previous=previous;
                sessions.put(key, session);
                owner = true;
            }
            session.lastUsed = clock.instant();
        }
        if (owner) launch(key, project, session);
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
            while (!(acquired = startupSlot.tryAcquire(50, TimeUnit.MILLISECONDS))) {
                requireActive(projectId, session);
                if (System.nanoTime() >= deadline) throw startTimeout();
            }
            requireActive(projectId,session);
            Path root = root(project);
            if(session.version==null) com.fengmotion.server.project.service.SourceWriteGuard.requireRecovered(root);
            else {
                var saved=scenes.findVersion(project.id(),session.version).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"not_found","版本不存在"));
                if(!"project-render".equals(saved.film().path("kind").asText())) throw LivePreviewProcess.unavailable("该版本没有源码工程");
                if(saved.film().path("sourceSnapshot").asText().isBlank() || saved.film().path("sourceHash").asText().isBlank()) {
                    throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"source_snapshot_unavailable","该历史版本没有可验证的源码快照");
                }
                session.workspace=snapshots.createWorkspace(root,saved.film().path("sourceSnapshot").asText(),saved.film().path("sourceHash").asText());
                root=session.workspace.path();
            }
            var config = config(root);
            requireActive(projectId, session);
            process = session.version==null?launcher.launch(root, config):launcher.launch(root,config,true);
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
            Session replaced;
            synchronized (sessions) {
                requireActive(projectId, session);
                session.status = new Status(project.id(), "ready", url, config.compositionId(), clock.instant());
                replaced=session.previous;
                session.previous=null;
                session.ready.complete(session.status);
            }
            if(replaced!=null) {
                try { stopProcess(replaced); }
                catch(RuntimeException failure) { log.warn("新预览已就绪，旧预览等待回收",failure); }
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            failStartup(projectId, session, LivePreviewProcess.unavailable("预览启动被中断"));
        } catch (RuntimeException failure) {
            failStartup(projectId, session, failure);
        } finally {
            try {
                if (session.status == null) {
                    session.process=process;
                    stopProcess(session);
                }
            } finally { if (acquired) startupSlot.release(); }
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
            if(sessions.get(projectId)==session && session.previous!=null) {
                sessions.put(projectId,session.previous);
                session.previous=null;
            } else sessions.remove(projectId, session);
        }
    }

    public Status get(String projectId) {
        return get(projectId,null);
    }

    public Status get(String projectId,Long version) {
        requireProject(projectId);
        String key=key(projectId,version);
        reap();
        Session session;
        Status status;
        synchronized (sessions) {
            session = sessions.get(key);
            if (session == null || session.status == null) return stopped(projectId);
            status = session.status;
        }
        boolean healthy = session.process.healthy(status.url());
        Session removed = null;
        synchronized (sessions) {
            if (sessions.get(key) != session) return stopped(projectId);
            if (!session.process.alive()) {
                removed = detach(key, LivePreviewProcess.unavailable("预览进程已退出"));
            } else {
                if (!healthy) log.debug("实时预览暂未响应，保留运行中进程 project={}", projectId);
                return status;
            }
        }
        stopProcess(removed);
        return stopped(projectId);
    }

    public void stop(String projectId) {
        stop(projectId,null);
    }

    public void stop(String projectId,Long version) {
        requireProject(projectId);
        Session removed;
        synchronized (sessions) { removed = detach(key(projectId,version), LivePreviewProcess.unavailable("预览已停止，请重新打开")); }
        stopProcess(removed);
    }

    public boolean isActive(String projectId) {
        synchronized (sessions) {
            Session session = sessions.get(projectId);
            return session != null && session.status != null && session.process.alive();
        }
    }

    void reap() {
        for(Session session:List.copyOf(stopping)) {
            try { stopProcess(session); }
            catch(RuntimeException failure) { log.warn("重试清理预览进程失败",failure); }
        }
        List<Session> removed = new ArrayList<>();
        Instant cutoff = clock.instant().minus(idleTimeout);
        Map<String, Session> copy;
        synchronized (sessions) { copy = new HashMap<>(sessions); }
        for (var entry : copy.entrySet()) {
            boolean missing = projects.findById(entry.getValue().projectId).isEmpty();
            synchronized (sessions) {
                Session session = entry.getValue();
                if (sessions.get(entry.getKey()) != session) continue;
                if (missing || (session.status != null
                        && (session.lastUsed.isBefore(cutoff) || !session.process.alive()))) {
                    removed.add(detach(entry.getKey(), LivePreviewProcess.unavailable("预览已回收，请重新打开")));
                }
            }
        }
        removed.forEach(this::stopProcess);
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
            if (config.shotTimeline() != null) return config;
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

    private String configurationSignature(Project project) {
        Path root=root(project);
        var config=config(root);
        return root+"|"+config.entry()+"|"+config.compositionId();
    }

    private Session detach(String projectId, RuntimeException failure) {
        Session session = sessions.remove(projectId);
        if (session != null) session.ready.completeExceptionally(failure);
        return session;
    }

    private void stopProcess(Session session) {
        if (session != null) {
            stopping.add(session);
            if(!session.stopInProgress.compareAndSet(false,true)) return;
            try {
                if (session.process != null) session.process.stop();
                if(session.previous!=null) {
                    stopProcess(session.previous);
                    session.previous=null;
                }
                if(session.workspace!=null) session.workspace.close();
                session.activity.close();
                stopping.remove(session);
            } finally { session.stopInProgress.set(false); }
        }
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
        removed.addAll(stopping);
        for(Session session:removed) {
            try { stopProcess(session); }
            catch(RuntimeException failure) { log.warn("关闭预览进程失败",failure); }
        }
    }

    private static Status stopped(String projectId) { return new Status(projectId, "stopped", null, null, null); }

    private static String key(String projectId,Long version) {
        if(version!=null && version<1) throw new ApiException(HttpStatus.BAD_REQUEST,"validation_error","版本号必须为正整数");
        return version==null?projectId:projectId+"@version:"+version;
    }

    public record Status(String projectId, String status, String url, String compositionId, Instant startedAt) { }

    private static final class Session {
        volatile LivePreviewProcess process;
        volatile Status status;
        final CompletableFuture<Status> ready = new CompletableFuture<>();
        Instant lastUsed;
        final ProjectOperationLock.Lease activity;
        final String projectId;
        final Long version;
        volatile com.fengmotion.server.project.service.ProjectSourceSnapshots.Workspace workspace;
        String configuration;
        Session previous;
        final java.util.concurrent.atomic.AtomicBoolean stopInProgress=new java.util.concurrent.atomic.AtomicBoolean();

        Session(Instant startedAt, ProjectOperationLock.Lease activity,String projectId,Long version) {
            this.lastUsed = startedAt;
            this.activity = activity;
            this.projectId=projectId;
            this.version=version;
        }
    }
}
