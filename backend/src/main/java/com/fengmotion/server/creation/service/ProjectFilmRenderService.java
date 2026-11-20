package com.fengmotion.server.creation.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.service.ProjectSourceFingerprint;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.store.CreationStateStore;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.ProjectFilmRenderer;
import com.fengmotion.server.render.service.VideoTimeline;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class ProjectFilmRenderService {
    private static final List<String> SOURCE_DIRS = List.of("src");
    private static final List<String> SOURCE_EXTENSIONS = List.of(
            ".tsx", ".ts", ".jsx", ".js", ".mjs", ".css", ".json");

    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ProjectFilmConfig configs;
    private final ProjectFilmRenderer renderer;
    private final ObjectMapper json;
    private final CreationStateStore creationStates;
    private final ProjectSourceSnapshots sourceSnapshots;

    public ProjectFilmRenderService(ProjectRepository projects, ProjectSceneRepository scenes,
                                    ProjectFilmConfig configs, ProjectFilmRenderer renderer,
                                    ObjectMapper json, CreationStateStore creationStates,
                                    ProjectSourceSnapshots sourceSnapshots) {
        this.projects = projects;
        this.scenes = scenes;
        this.configs = configs;
        this.renderer = renderer;
        this.json = json;
        this.creationStates = creationStates;
        this.sourceSnapshots = sourceSnapshots;
    }

    RenderResult render(String projectId, String prompt) {
        Project project = projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        String rootPath = project.rootPath();
        if (rootPath == null || rootPath.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目还没有目录");
        }
        Path root = Path.of(rootPath).toAbsolutePath().normalize();
        configs.read(root);
        String sourceSnapshot = sourceSnapshots.capture(root);
        Path renderRoot = sourceSnapshots.resolve(root, sourceSnapshot);
        ProjectFilmConfig.FilmConfig config = configs.read(renderRoot);

        String fileName = "project-" + Instant.now().toEpochMilli() + "-" + UUID.randomUUID() + ".mp4";
        Path output = root.resolve("renders").resolve(fileName);
        long baseVersion = scenes.find(projectId)
                .filter(ProjectScene::present).map(ProjectScene::version).orElse(0L);
        Instant startedAt = Instant.now();
        try {
            ProjectFilmRenderer.Result result = renderer.render(renderRoot, config, output);
            long elapsedMs = java.time.Duration.between(startedAt, Instant.now()).toMillis();

            ObjectNode fingerprint = (ObjectNode) fingerprint(renderRoot, config, result, elapsedMs);
            String sourceHash = ProjectSourceFingerprint.compute(renderRoot);
            fingerprint.put("sourceSnapshot", sourceSnapshot);
            fingerprint.put("sourceHash", sourceHash);
            VideoTimeline.write(json, output, "renders/" + fileName, result.sequences(),
                    result.durationInFrames(), result.fps(), sourceHash, false);
            var creation = creationStates.read(root);
            if (creation != null && creation.references() != null) fingerprint.set("resources", creation.references());

            Optional<Long> committed = scenes.commitWithSnapshot(
                    projectId, baseVersion, fingerprint, null,
                    prompt == null ? "" : prompt,
                    "渲染项目工程 " + config.entry() + " · " + config.compositionId(),
                    "renders/" + fileName,
                    ProjectSceneVersion.SOURCE_TASK, null);

            if (committed.isEmpty()) {
                throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict",
                        "项目在你渲染期间被更新了，本次结果未提交");
            }
            return new RenderResult("renders/" + fileName, committed.get(),
                    config.entry(), config.compositionId(), result, elapsedMs);
        } catch (RuntimeException failure) {
            try {
                VideoTimeline.discard(output);
            } catch (IOException cleanup) {
                failure.addSuppressed(cleanup);
            }
            throw failure;
        }
    }

    void validateConfig(Path root) {
        configs.read(root);
    }

    List<String> sourceFiles(Path root) {
        List<String> out = new ArrayList<>();
        for (String dir : SOURCE_DIRS) {
            Path dirPath = root.resolve(dir);
            if (!Files.isDirectory(dirPath)) continue;
            try (Stream<Path> walk = Files.walk(dirPath)) {
                walk.filter(Files::isRegularFile).forEach(file -> out.add(
                        root.relativize(file).toString().replace('\\', '/')));
            } catch (IOException ignored) {
            }
        }
        return out;
    }

    private JsonNode fingerprint(Path root, ProjectFilmConfig.FilmConfig config,
                                 ProjectFilmRenderer.Result result, long elapsedMs) {
        ObjectNode node = json.createObjectNode();
        node.put("kind", "project-render");
        node.put("entry", config.entry());
        node.put("compositionId", config.compositionId());

        ObjectNode output = node.putObject("output");
        output.put("durationInFrames", result.durationInFrames());
        output.put("width", result.width());
        output.put("height", result.height());
        output.put("fps", result.fps());
        output.put("renderMs", elapsedMs);

        node.set("sources", sourceEntries(json, root));
        node.set("dependencies", dependencyVersions());
        return node;
    }

    static ArrayNode sourceEntries(ObjectMapper json, Path root) {
        ArrayNode sources = json.createArrayNode();
        for (String dir : SOURCE_DIRS) {
            Path dirPath = root.resolve(dir);
            if (!Files.isDirectory(dirPath)) continue;
            try (Stream<Path> walk = Files.walk(dirPath)) {
                for (Path file : walk.filter(Files::isRegularFile).toList()) {
                    String name = file.getFileName().toString().toLowerCase();
                    if (SOURCE_EXTENSIONS.stream().noneMatch(name::endsWith)) continue;
                    ObjectNode item = sources.addObject();
                    item.put("path", root.relativize(file).toString().replace('\\', '/'));
                    item.put("bytes", Files.size(file));
                    item.put("modifiedAt", Files.getLastModifiedTime(file).toInstant().toString());
                }
            } catch (IOException unreadable) {
                log.warn("读取源码清单失败：{}", dirPath);
            }
        }

        return sources;
    }

    private JsonNode dependencyVersions() {
        ObjectNode node = json.createObjectNode();
        Path pkg = Path.of(System.getProperty("user.dir"))
                .resolve("..").resolve("frontend").resolve("package.json").normalize();
        if (!Files.isRegularFile(pkg)) return node;
        try {
            JsonNode root = json.readTree(Files.readString(pkg));
            for (String key : List.of("remotion", "@remotion/renderer", "@remotion/bundler", "react")) {
                JsonNode deps = root.path("dependencies").has(key)
                        ? root.path("dependencies") : root.path("devDependencies");
                String version = deps.path(key).asText("");
                if (!version.isBlank()) node.put(key, version);
            }
        } catch (IOException ignored) {
        }
        return node;
    }

    record RenderResult(String artifactPath, long version, String entry,
                        String compositionId, ProjectFilmRenderer.Result result,
                        long renderMs) {
    }
}
