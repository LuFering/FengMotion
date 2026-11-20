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
        Path script = script();
        Path modules = modules(script);
        try {
            Files.createDirectories(logs);
            String id = UUID.randomUUID().toString();
            Path stdout = logs.resolve(id + ".stdout.log");
            Path stderr = logs.resolve(id + ".stderr.log");
            Process process = new ProcessBuilder(List.of(node, script.toString(), "--project", root.toString(),
                    "--entry", config.entry(), "--composition", config.compositionId(),
                    "--node-modules", modules.toString(), "--host", "127.0.0.1", "--port", "0"))
                    .directory(script.getParent().toFile()).redirectOutput(stdout.toFile()).redirectError(stderr.toFile()).start();
            return new LivePreviewProcess(process, stdout, stderr, json);
        } catch (IOException failure) {
            throw LivePreviewProcess.unavailable("无法启动实时预览，请检查 Node 可执行文件和日志目录");
        }
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
