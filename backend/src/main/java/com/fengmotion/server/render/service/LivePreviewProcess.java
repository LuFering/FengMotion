package com.fengmotion.server.render.service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.http.HttpStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import lombok.extern.slf4j.Slf4j;

@Slf4j
class LivePreviewProcess {
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build();
    private final Process process;
    private final Path stdout;
    private final Path stderr;
    private final ObjectMapper json;
    private final java.util.List<PreviewLogSink> logSinks;
    private final AtomicBoolean stopped = new AtomicBoolean();
    private final AtomicBoolean logsClosed = new AtomicBoolean();
    private final Runnable afterLogsClosed;
    private java.util.List<ProcessHandle> stoppingChildren = java.util.List.of();

    LivePreviewProcess(Process process, Path stdout, Path stderr, ObjectMapper json) {
        this(process, stdout, stderr, json, java.util.List.of(), () -> { });
    }

    LivePreviewProcess(Process process, Path stdout, Path stderr, ObjectMapper json, java.util.List<PreviewLogSink> logSinks, Runnable afterLogsClosed) {
        this.process = process;
        this.stdout = stdout;
        this.stderr = stderr;
        this.json = json;
        this.logSinks = logSinks;
        this.afterLogsClosed = afterLogsClosed;
    }

    String awaitReady(Duration timeout) {
        long deadline = System.nanoTime() + timeout.toNanos();
        try {
            while (System.nanoTime() < deadline && !stopped.get()) {
                byte[] bytes;
                try (var input = Files.newInputStream(stdout)) { bytes = input.readNBytes(16_385); }
                String output = new String(bytes, StandardCharsets.UTF_8);
                int newline = output.indexOf('\n');
                if (newline >= 0) {
                    var signal = json.readTree(output.substring(0, newline));
                    if (signal != null && "failed".equals(signal.path("event").asText())) {
                        String reason = switch (signal.path("code").asText()) {
                            case "entry_missing" -> "预览脚本找不到工程入口";
                            case "dependency_missing" -> "共享运行时缺少预览依赖，请检查预览日志";
                            case "listen_failed" -> "预览服务无法监听本机端口";
                            default -> "预览进程启动失败，请检查预览日志";
                        };
                        throw unavailable(reason);
                    }
                    if (signal == null || !"ready".equals(signal.path("event").asText())) throw unavailable("预览进程就绪信号无效");
                    String url = signal.path("url").asText();
                    URI address = URI.create(url);
                    if (!"http".equals(address.getScheme()) || !"127.0.0.1".equals(address.getHost())
                            || address.getPort() < 1 || address.getPort() > 65535 || address.getUserInfo() != null
                            || !"/".equals(address.getPath()) || address.getQuery() != null || address.getFragment() != null) {
                        throw unavailable("预览进程未返回有效的本机地址");
                    }
                    if (!healthy(url)) throw unavailable("预览进程已就绪，但页面无法访问");
                    return url;
                }
                if (bytes.length > 16_384) throw unavailable("预览进程就绪信号过长");
                if (!process.isAlive()) throw unavailable("预览进程在就绪前退出，请检查预览日志");
                Thread.sleep(20);
            }
            if (stopped.get()) throw unavailable("预览启动已停止");
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "live_preview_start_timeout", "等待预览就绪超时，进程已清理");
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw unavailable("预览启动被中断");
        } catch (IOException | IllegalArgumentException invalid) {
            throw unavailable("预览进程返回无效信号，请检查预览日志");
        }
    }

    boolean alive() { return !stopped.get() && process.isAlive(); }

    boolean healthy(String url) {
        if (!alive()) return false;
        try {
            var request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(2)).GET().build();
            return HTTP.send(request, HttpResponse.BodyHandlers.discarding()).statusCode() == 200 && alive();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        } catch (IOException failure) {
            return false;
        }
    }

    synchronized void stop() {
        if (stopped.compareAndSet(false, true)) stoppingChildren=process.descendants().toList();
        var children = stoppingChildren;
        children.forEach(ProcessHandle::destroy);
        process.destroy();
        try {
            process.waitFor(500, TimeUnit.MILLISECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } finally {
            children.stream().filter(ProcessHandle::isAlive).forEach(ProcessHandle::destroyForcibly);
            if (process.isAlive()) process.destroyForcibly();
            boolean interrupted=Thread.interrupted();
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);
            while(System.nanoTime()<deadline && (process.isAlive() || children.stream().anyMatch(ProcessHandle::isAlive))) {
                try { Thread.sleep(10); }
                catch(InterruptedException failure) { interrupted=true; }
            }
            if(interrupted) Thread.currentThread().interrupt();
            if(process.isAlive() || children.stream().anyMatch(ProcessHandle::isAlive)) {
                throw unavailable("预览进程尚未完全退出，项目继续保持占用，请检查进程后重试");
            }
            logSinks.forEach(PreviewLogSink::close);
            if (logsClosed.compareAndSet(false, true)) afterLogsClosed.run();
        }
    }

    void logExit(String projectId) {
        process.onExit().thenRun(() -> {
            if (!stopped.get()) log.warn("实时预览进程退出 project={} exit={} stdout={} stderr={}",
                    projectId, process.exitValue(), stdout, stderr);
        });
    }

    static ApiException unavailable(String message) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "live_preview_unavailable", message);
    }
}
