package com.fengmotion.server.creation.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.domain.SceneEditMetadata;
import com.fengmotion.server.project.domain.SceneElementEditRequest;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.service.ProjectSourceFingerprint;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.service.SceneCommitVerifier;
import com.fengmotion.server.project.service.SceneEditMetadataService;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.ProjectFilmRenderer;
import com.fengmotion.server.render.service.VideoTimeline;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/** 对源码工程中的一个已声明元素执行版本化修改。 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SceneElementEditService {
    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ProjectOperationLock operations;
    private final ProjectSourceSnapshots snapshots;
    private final ProjectFilmConfig configs;
    private final SceneEditMetadataService metadata;
    private final ProjectFilmRenderer renderer;
    private final ObjectMapper json;

    public EditResult edit(String projectId, SceneElementEditRequest request) {
        validateRequest(request);
        String text = requestedText(request.properties());
        operations.acquire(projectId);
        try {
            return editUnlocked(projectId, request, text);
        } finally {
            operations.release(projectId);
        }
    }

    private EditResult editUnlocked(String projectId, SceneElementEditRequest request, String text) {
        Project project = projects.findById(projectId).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        ProjectScene current = scenes.find(projectId).filter(ProjectScene::present).orElseThrow(() ->
                new ApiException(HttpStatus.CONFLICT, "scene_not_initialized", "项目还没有可编辑的当前场景"));
        if(project.rootPath()!=null && Files.isSymbolicLink(Path.of(project.rootPath()).resolve("renders"))) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"render_path_invalid","渲染目录不能是符号链接");
        }
        if (current.version() != request.baseVersion()) {
            throw versionConflict(current.version(), request.baseVersion());
        }

        ProjectSceneVersion version = scenes.findVersion(projectId, request.baseVersion()).orElseThrow(() ->
                new ApiException(HttpStatus.CONFLICT, "scene_version_conflict", "当前版本历史快照不存在，请刷新后重试"));
        JsonNode film = version.film();
        if (film == null || !film.isObject() || !"project-render".equals(film.path("kind").asText())) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "element_edit_unavailable",
                    "该版本不是可编辑的源码工程");
        }
        String snapshotReference = film.path("sourceSnapshot").asText("");
        String recordedHash = film.path("sourceHash").asText("");
        if (snapshotReference.isBlank() || recordedHash.isBlank()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "source_snapshot_unavailable",
                    "该版本没有可校验的工程源码快照");
        }
        if (!recordedHash.equals(request.sourceHash())) {
            throw new ApiException(HttpStatus.CONFLICT, "source_version_conflict",
                    "工程源码版本已变化，请重新读取元素后再提交");
        }

        SceneEditMetadata declared = metadata.read(project, version);
        if (!"declared".equals(declared.status())) {
            String reason = declared.reason() == null ? "该版本没有可编辑元素声明" : declared.reason().message();
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "element_edit_unavailable", reason);
        }
        SceneEditMetadata.Element element = declared.elements().stream()
                .filter(item -> item.id().equals(request.elementId()))
                .findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "element_not_found",
                        "版本中不存在元素 " + request.elementId()));
        if (text.equals(element.properties().text())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "element_edit_noop", "元素文字没有变化");
        }

        Path root = Path.of(project.rootPath()).toAbsolutePath().normalize();
        requireWorkingSource(root, recordedHash);
        if (Files.exists(root.resolve("renders"), LinkOption.NOFOLLOW_LINKS)
                && !Files.isDirectory(root.resolve("renders"), LinkOption.NOFOLLOW_LINKS)) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "element_edit_unavailable", "项目产物目录无效");
        }
        Path output = root.resolve("renders").resolve("project-element-" + Instant.now().toEpochMilli()
                + "-" + UUID.randomUUID() + ".mp4");
        String artifactPath = "renders/" + output.getFileName();
        String createdSnapshot = null;
        boolean committed = false;
        try (ProjectSourceSnapshots.Workspace workspace = snapshots.createWorkspace(root, snapshotReference, recordedHash)) {
            Path manifest = workspace.path().resolve(SceneEditMetadataService.MANIFEST);
            metadata.updateText(manifest, request.elementId(), text,
                    film.path("output").path("durationInFrames").asInt());
            String sourceHash = ProjectSourceFingerprint.compute(workspace.path());
            createdSnapshot = snapshots.capture(root, workspace.path());
            Path captured = snapshots.resolve(root, createdSnapshot, sourceHash);
            ProjectFilmConfig.FilmConfig config = configs.read(captured);
            Instant started = Instant.now();
            ProjectFilmRenderer.Result result = renderer.render(captured, config, output);
            long elapsed = Duration.between(started, Instant.now()).toMillis();
            snapshots.resolve(root, createdSnapshot, sourceHash);
            metadata.validateManifest(captured.resolve(SceneEditMetadataService.MANIFEST), result.durationInFrames());

            ObjectNode updatedFilm = ((ObjectNode) film).deepCopy();
            updatedFilm.put("sourceSnapshot", createdSnapshot);
            updatedFilm.put("sourceHash", sourceHash);
            ObjectNode outputMetadata = updatedFilm.path("output").isObject()
                    ? (ObjectNode) updatedFilm.path("output") : updatedFilm.putObject("output");
            outputMetadata
                    .put("durationInFrames", result.durationInFrames())
                    .put("width", result.width())
                    .put("height", result.height())
                    .put("fps", result.fps())
                    .put("renderMs", elapsed);
            updatedFilm.set("sources", ProjectFilmRenderService.sourceEntries(json, captured));
            updatedFilm.set("dependencies", result.dependencies() != null && result.dependencies().isObject()
                    ? result.dependencies().deepCopy() : json.createObjectNode());
            VideoTimeline.write(json, output, artifactPath, result.sequences(),
                    result.durationInFrames(), result.fps(), sourceHash, false);

            long committedVersion = writeBackAndCommit(root, manifest, recordedHash, sourceHash,
                    projectId, request, updatedFilm, artifactPath);
            committed = true;
            return new EditResult(projectId, committedVersion, artifactPath, sourceHash,
                    request.elementId(), text);
        } catch(RuntimeException failure) {
            if(SceneCommitVerifier.uncertain(failure)) committed=true;
            throw failure;
        } finally {
            if (!committed && createdSnapshot != null) {
                cleanup(output);
                snapshots.discard(root, createdSnapshot);
            }
        }
    }

    private long writeBackAndCommit(Path root, Path edited, String baseHash, String editedHash,
                                    String projectId, SceneElementEditRequest request, ObjectNode film,
                                    String artifactPath) {
        try (var write = com.fengmotion.server.project.service.SourceWriteGuard.acquire(root)) {
            return writeBackLocked(root,edited,baseHash,editedHash,projectId,request,film,artifactPath);
        }
    }

    private long writeBackLocked(Path root,Path edited,String baseHash,String editedHash,
                                 String projectId,SceneElementEditRequest request,ObjectNode film,String artifactPath) {
        requireWorkingSource(root, baseHash);
        try (var recovery=snapshots.restore(root,film.path("sourceSnapshot").asText(),editedHash)) {
            try {
            requireWorkingSource(root, editedHash);
            String summary = "修改元素 " + request.elementId() + " 的文字";
            long version=SceneCommitVerifier.commit(scenes,projectId,request.baseVersion(),film,artifactPath,()->scenes.commitWithSnapshot(projectId, request.baseVersion(), film, null,
                    request.prompt() == null || request.prompt().isBlank() ? summary : request.prompt(),
                    summary, artifactPath, ProjectSceneVersion.SOURCE_ELEMENT_EDIT, null)).orElseThrow(() ->
                    new ApiException(HttpStatus.CONFLICT, "scene_version_conflict", "项目在元素修改期间被更新了，本次结果未提交"));
            recovery.commit();
            return version;
            } catch(RuntimeException failure) {
                if(SceneCommitVerifier.uncertain(failure)) recovery.retainPending();
                throw failure;
            }
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR,"manifest_rollback_failed","无法完成元素修改恢复，请核对恢复日志");
        }
    }

    private static void requireWorkingSource(Path root, String expected) {
        Path manifest = root.resolve(SceneEditMetadataService.MANIFEST);
        if (!Files.isDirectory(manifest.getParent(), LinkOption.NOFOLLOW_LINKS)
                || !Files.isRegularFile(manifest, LinkOption.NOFOLLOW_LINKS)
                || !expected.equals(ProjectSourceFingerprint.compute(root))) {
            throw workingSourceConflict();
        }
    }

    private static ApiException workingSourceConflict() {
        return new ApiException(HttpStatus.CONFLICT, "working_source_conflict",
                "工作区源码与基线不同；请保留现有修改，渲染成新版本后再编辑");
    }

    private static String requestedText(JsonNode properties) {
        if (properties == null || !properties.isObject() || properties.size() != 1
                || !properties.has("text") || !properties.path("text").isTextual()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "unsupported_element_property",
                    "当前只支持修改文字元素的 properties.text");
        }
        String text = properties.path("text").asText();
        if (text.length() > SceneEditMetadataService.MAX_TEXT_LENGTH) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文字长度不能超过 2000 个字符");
        }
        return text;
    }

    private static void validateRequest(SceneElementEditRequest request) {
        if (request == null || request.baseVersion() == null || request.baseVersion() <= 0
                || request.sourceHash() == null || !request.sourceHash().matches("files=\\d+;sha256=(?:[0-9a-f]{64}|empty)")
                || request.elementId() == null || !request.elementId().matches("[a-z][a-z0-9_-]{0,63}")
                || (request.prompt() != null && request.prompt().length() > 4000)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "需要有效的 baseVersion、sourceHash 和 elementId；prompt 最多 4000 个字符");
        }
    }

    private static ApiException versionConflict(long actual, long expected) {
        return new ApiException(HttpStatus.CONFLICT, "scene_version_conflict",
                "场景已被更新到版本 " + actual + "，你提交的是版本 " + expected + "，请刷新后重试");
    }

    private static void cleanup(Path output) {
        if (!Files.isDirectory(output.getParent(), LinkOption.NOFOLLOW_LINKS)) return;
        try {
            VideoTimeline.discard(output);
        } catch (IOException failure) {
            log.warn("未提交的元素编辑产物清理失败：{}", output, failure);
        }
    }

    public record EditResult(String projectId, long version, String artifactPath, String sourceHash,
                             String elementId, String text) { }
}
