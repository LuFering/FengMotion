package com.fengmotion.server.render.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.service.ProjectFilmConfig;

@Component
public class LivePreviewLauncher {
    private final ObjectMapper json;
    private final String scriptDirectory;
    private final String remotionDirectory;
    private final String nodeModules;
    private final String node;
    private final Path logs;
    @Value("${fengmotion.live-preview.max-log-bytes:8388608}")
    private long maxLogBytes = 8_388_608;
    private final java.util.Set<Path> activeLogs = java.util.concurrent.ConcurrentHashMap.newKeySet();

    public LivePreviewLauncher(ObjectMapper json,
            @Value("${fengmotion.live-preview.project-dir:}") String scriptDirectory,
            @Value("${fengmotion.remotion.project-dir:}") String remotionDirectory,
            @Value("${fengmotion.remotion.node-modules:}") String nodeModules,
            @Value("${fengmotion.remotion.node:node}") String node,
            @Value("${fengmotion.data-dir:${user.home}/.config/FengMotion/data}") String dataDirectory) {
        this.json = json;
        this.scriptDirectory = scriptDirectory;
        this.remotionDirectory = remotionDirectory;
        this.nodeModules = nodeModules;
        this.node = node;
        this.logs = Path.of(dataDirectory).toAbsolutePath().resolve("logs/live-preview");
    }

    LivePreviewProcess launch(Path root, ProjectFilmConfig.FilmConfig config) {
        return launch(root,config,false);
    }

    LivePreviewProcess launch(Path root,ProjectFilmConfig.FilmConfig config,boolean readOnly) {
        Path script = script();
        Path modules = modules(script);
        try {
            Files.createDirectories(logs);
            pruneLogs();
            String id = UUID.randomUUID().toString();
            Path stdout = logs.resolve(id + ".stdout.log");
            Path stderr = logs.resolve(id + ".stderr.log");
            var command=new java.util.ArrayList<>(List.of(node, script.toString(), "--project", root.toString(),
                    "--entry", config.entry(), "--composition", config.compositionId(),
                    "--node-modules", modules.toString(), "--host", "127.0.0.1", "--port", "0", "--read-only", Boolean.toString(readOnly)));
            if(config.shotTimeline()!=null) {
                command.add("--shot-assembly");
                command.add(RenderRuntimePaths.script(remotionDirectory,"shot-assembly.mjs").toString());
            }
            Process process = new ProcessBuilder(command).directory(script.getParent().toFile()).start();
            PreviewLogSink stdoutSink = null;
            PreviewLogSink stderrSink = null;
            try {
                synchronized (this) { activeLogs.add(stdout); activeLogs.add(stderr); }
                long limit = Math.max(16384, Math.min(maxLogBytes, 67_108_864));
                stdoutSink = PreviewLogSink.start(process.getInputStream(), stdout, limit);
                stderrSink = PreviewLogSink.start(process.getErrorStream(), stderr, limit);
                return new LivePreviewProcess(process, stdout, stderr, json, List.of(stdoutSink, stderrSink), () -> {
                    activeLogs.remove(stdout);
                    activeLogs.remove(stderr);
                    pruneLogs();
                });
            } catch (IOException | RuntimeException failure) {
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
                if (stdoutSink != null) stdoutSink.close();
                if (stderrSink != null) stderrSink.close();
                activeLogs.remove(stdout);
                activeLogs.remove(stderr);
                throw failure;
            }
        } catch (IOException failure) {
            throw LivePreviewProcess.unavailable("无法启动实时预览，请检查 Node 可执行文件和日志目录");
        }
    }

    private synchronized void pruneLogs() {
        try (var files = Files.list(logs)) {
            var candidates = new java.util.ArrayList<Path>();
            for (Path file : files.toList()) {
                if (!activeLogs.contains(file) && Files.isRegularFile(file, java.nio.file.LinkOption.NOFOLLOW_LINKS)
                        && file.getFileName().toString().matches("[0-9a-f-]{36}\\.(stdout|stderr)\\.log")) candidates.add(file);
            }
            candidates.sort(java.util.Comparator.comparingLong((Path file) -> {
                try { return Files.getLastModifiedTime(file).toMillis(); } catch (IOException failure) { return Long.MAX_VALUE; }
            }).reversed());
            long bytes = 0;
            long cutoff = System.currentTimeMillis() - java.time.Duration.ofDays(7).toMillis();
            for (int index = 0; index < candidates.size(); index++) {
                Path file = candidates.get(index);
                long size = Files.size(file);
                if (index >= 40 || bytes + size > 134_217_728 || Files.getLastModifiedTime(file).toMillis() < cutoff) Files.deleteIfExists(file);
                else bytes += size;
            }
        } catch (IOException failure) {
            org.slf4j.LoggerFactory.getLogger(LivePreviewLauncher.class).warn("预览历史日志清理失败", failure);
        }
    }

    public String unavailableReason() {
        try {
            Path script=script();
            Path modules=modules(script);
            for(String dependency:List.of("react","react-dom","remotion","@remotion/player","@babel/parser","@babel/core","esbuild")) {
                if(!Files.isRegularFile(modules.resolve(dependency).resolve("package.json"))) return "实时预览依赖缺失："+dependency;
            }
            return null;
        } catch(com.fengmotion.server.common.ApiException failure) { return failure.getMessage(); }
    }

    private Path script() {
        if (!scriptDirectory.isBlank()) {
            Path script = Path.of(scriptDirectory).toAbsolutePath().normalize().resolve("server.mjs");
            if (Files.isRegularFile(script)) return script;
            throw LivePreviewProcess.unavailable("实时预览脚本缺失，请检查 fengmotion.live-preview.project-dir");
        }
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        Path remotion = remotionDirectory.isBlank() ? cwd.resolve("remotion") : Path.of(remotionDirectory).toAbsolutePath();
        for (Path directory : List.of(remotion.resolveSibling("live-preview"),
                cwd.resolve("../frontend/live-preview"), cwd.resolve("frontend/live-preview"),
                cwd.resolve("FengMotion-desktop/frontend/live-preview"))) {
            Path script = directory.normalize().resolve("server.mjs");
            if (Files.isRegularFile(script)) return script;
        }
        throw LivePreviewProcess.unavailable("找不到实时预览脚本，请配置 fengmotion.live-preview.project-dir");
    }

    private Path modules(Path script) {
        if (!nodeModules.isBlank()) {
            Path modules = Path.of(nodeModules).toAbsolutePath().normalize();
            if (Files.isDirectory(modules)) return modules;
            throw LivePreviewProcess.unavailable("渲染共享依赖目录不存在，请检查 fengmotion.remotion.node-modules");
        }
        for (Path modules : List.of(script.getParent().resolveSibling("remotion/node_modules"),
                script.getParent().resolveSibling("node_modules"))) {
            if (Files.isDirectory(modules)) return modules.toAbsolutePath().normalize();
        }
        throw LivePreviewProcess.unavailable("找不到渲染共享依赖目录");
    }
}
