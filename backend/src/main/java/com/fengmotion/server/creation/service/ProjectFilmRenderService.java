package com.fengmotion.server.creation.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.BooleanSupplier;

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
import com.fengmotion.server.project.domain.SourceRenderRequest;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.service.ProjectSourceFingerprint;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.service.ProjectSourceLayout;
import com.fengmotion.server.project.service.SceneCommitVerifier;
import com.fengmotion.server.project.store.CreationStateStore;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.ProjectFilmRenderer;
import com.fengmotion.server.render.service.VideoTimeline;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class ProjectFilmRenderService {
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
        return render(projectId, prompt, false);
    }

    RenderResult render(String projectId, String prompt, boolean requireShots) {
        return renderInternal(projectId, prompt, requireShots, null, () -> false);
    }

    RenderResult renderGuarded(String projectId, SourceRenderRequest request) {
        return renderGuarded(projectId, request, () -> false);
    }

    RenderResult renderGuarded(String projectId, SourceRenderRequest request, BooleanSupplier cancelled) {
        request.validate();
        return renderInternal(projectId, request.prompt(), false, request, cancelled);
    }

    private RenderResult renderInternal(String projectId, String prompt, boolean requireShots,
                                        SourceRenderRequest request, BooleanSupplier cancelled) {
        return renderInternal(projectId,prompt,requireShots,request,cancelled,null);
    }

    RenderResult renderCreation(String projectId,String prompt,boolean requireShots,String creationRequestId) {
        return renderInternal(projectId,prompt,requireShots,null,()->false,creationRequestId);
    }

    private RenderResult renderInternal(String projectId,String prompt,boolean requireShots,SourceRenderRequest request,
                                        BooleanSupplier cancelled,String creationRequestId) {
        requireRunning(cancelled);
        Project project = projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        String rootPath = project.rootPath();
        if (rootPath == null || rootPath.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目还没有目录");
        }
        Path root = Path.of(rootPath).toAbsolutePath().normalize();
        com.fengmotion.server.project.service.SourceWriteGuard.requireRecovered(root);
        var current = scenes.find(projectId).orElse(null);
        if (current != null && !current.present()) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,
                "scene_corrupt", "当前场景记录损坏，未执行出片，请核对历史版本");
        long baseVersion = current == null ? 0 : current.version();
        if (request != null && request.baseVersion() != baseVersion) {
            throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict", "当前版本已变化，请重新核对工作稿后出片");
        }
        readConfig(root, requireShots);
        String sourceSnapshot = sourceSnapshots.captureVerified(root,request==null
                ? com.fengmotion.server.project.service.ProjectWorktreeService.fingerprint(root) : request.sourceHash());

        String fileName = "project-" + Instant.now().toEpochMilli() + "-" + UUID.randomUUID() + ".mp4";
        Path output = root.resolve("renders").resolve(fileName);
        if(Files.isSymbolicLink(root.resolve("renders"))) {
            sourceSnapshots.discard(root,sourceSnapshot);
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"render_path_invalid","渲染目录不能是符号链接");
        }
        Instant startedAt = Instant.now();
        try {
            Path renderRoot = sourceSnapshots.resolve(root, sourceSnapshot);
            requireRunning(cancelled);
            ProjectFilmConfig.FilmConfig config = readConfig(renderRoot, requireShots);
            if (requireShots && baseVersion != 0) {
                throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict", "首次制作期间已有新场景版本，未覆盖");
            }
            ProjectFilmRenderer.Result result = renderer.render(renderRoot, config, output);
            requireRunning(cancelled);
            sourceSnapshots.resolve(root,sourceSnapshot);
            var timeline = config.shotTimeline();
            if (timeline != null && (result.durationInFrames() != timeline.durationInFrames()
                    || result.fps() != timeline.fps() || result.width() != timeline.width() || result.height() != timeline.height())) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_render_mismatch", "渲染规格与镜头装配清单不一致");
            }
            long elapsedMs = java.time.Duration.between(startedAt, Instant.now()).toMillis();

            ObjectNode fingerprint = (ObjectNode) fingerprint(renderRoot, config, result, elapsedMs);
            String sourceHash = ProjectSourceFingerprint.compute(renderRoot);
            fingerprint.put("sourceSnapshot", sourceSnapshot);
            fingerprint.put("sourceHash", sourceHash);
            if (request != null) fingerprint.set("sourceRenderRequest", json.valueToTree(request));
            if(creationRequestId!=null && !creationRequestId.isBlank()) fingerprint.put("creationRequestId",creationRequestId);
            VideoTimeline.write(json, output, "renders/" + fileName, result.sequences(),
                    result.durationInFrames(), result.fps(), sourceHash, false);
            var creation = creationStates.read(root);
            if (creation != null && creation.references() != null) fingerprint.set("resources", creation.references());

            requireRunning(cancelled);

            Optional<Long> committed = SceneCommitVerifier.commit(scenes,projectId,baseVersion,fingerprint,"renders/"+fileName,()->scenes.commitWithSnapshot(
                    projectId, baseVersion, fingerprint, null,
                    prompt == null ? "" : prompt,
                    "渲染项目工程 " + config.entry() + " · " + config.compositionId(),
                    "renders/" + fileName,
                    ProjectSceneVersion.SOURCE_TASK, null));

            if (committed.isEmpty()) {
                throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict",
                        "项目在你渲染期间被更新了，本次结果未提交");
            }
            return new RenderResult("renders/" + fileName, committed.get(),
                    config.entry(), config.compositionId(), result, elapsedMs);
        } catch (RuntimeException failure) {
            if(SceneCommitVerifier.uncertain(failure)) throw failure;
            try {
                VideoTimeline.discard(output);
            } catch (IOException cleanup) {
                failure.addSuppressed(cleanup);
            }
            sourceSnapshots.discard(root, sourceSnapshot);
            throw failure;
        }
    }

    private static void requireRunning(BooleanSupplier cancelled) {
        CreationCancellation.requireRunning();
        if (cancelled.getAsBoolean() || Thread.currentThread().isInterrupted()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "render_interrupted", "出片已中断，未登记新版本");
        }
    }

    void validateConfig(Path root) {
        configs.read(root);
    }

    void requireProject(String projectId) {
        projects.findById(projectId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
    }

    private ProjectFilmConfig.FilmConfig readConfig(Path root, boolean requireShots) {
        var config = configs.read(root);
        if (requireShots && config.shotTimeline() == null) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_timeline_required", "本轮请求按镜头装配，不能使用旧版源码入口");
        }
        return config;
    }

    List<String> sourceFiles(Path root) {
        try {
            return ProjectSourceLayout.files(root).stream()
                    .map(file -> root.relativize(file).toString().replace('\\', '/')).toList();
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "source_unreadable", "无法完整读取工程源码清单");
        }
    }

    private JsonNode fingerprint(Path root, ProjectFilmConfig.FilmConfig config,
                                 ProjectFilmRenderer.Result result, long elapsedMs) {
        ObjectNode node = json.createObjectNode();
        node.put("kind", "project-render");
        node.put("entry", config.entry());
        node.put("compositionId", config.compositionId());
        if (config.shotTimeline() != null) node.set("shotTimeline", json.valueToTree(config.shotTimeline()));

        ObjectNode output = node.putObject("output");
        output.put("durationInFrames", result.durationInFrames());
        output.put("width", result.width());
        output.put("height", result.height());
        output.put("fps", result.fps());
        output.put("renderMs", elapsedMs);

        node.set("sources", sourceEntries(json, root));
        node.set("dependencies", result.dependencies() != null && result.dependencies().isObject()
                ? result.dependencies().deepCopy() : json.createObjectNode());
        return node;
    }

    static ArrayNode sourceEntries(ObjectMapper json, Path root) {
        ArrayNode sources = json.createArrayNode();
        try {
            for (Path file : ProjectSourceLayout.files(root)) {
                ObjectNode item = sources.addObject();
                item.put("path", root.relativize(file).toString().replace('\\', '/'));
                item.put("bytes", Files.size(file));
                item.put("modifiedAt", Files.getLastModifiedTime(file).toInstant().toString());
            }
        } catch (IOException unreadable) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "source_unreadable", "无法完整读取工程源码清单");
        }

        return sources;
    }

    record RenderResult(String artifactPath, long version, String entry,
                        String compositionId, ProjectFilmRenderer.Result result,
                        long renderMs) {
    }
}
