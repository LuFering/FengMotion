package com.fengmotion.server.creation.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Value;
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
import com.fengmotion.server.project.domain.ShotCandidateRequest;
import com.fengmotion.server.project.domain.ShotTimeline;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.service.ProjectSourceFingerprint;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.service.SceneCommitVerifier;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.ProjectFilmRenderer;
import com.fengmotion.server.render.service.VideoTimeline;

import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
public class ShotCandidateService {
    private static final String DIRECTORY = ".fengmotion/shot-candidates";
    private static final String SOURCE_NAME = "component.tsx";
    private static final String METADATA_NAME = "candidate.json";
    private static final int MAX_SOURCE_BYTES = 262_144;
    private static final int MAX_METADATA_BYTES = 16_384;
    private static final long AUDIO_TIMEOUT_SECONDS = 60;

    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ProjectOperationLock operations;
    private final ProjectSourceSnapshots snapshots;
    private final ProjectFilmConfig configs;
    private final ProjectFilmRenderer renderer;
    private final ObjectMapper json;
    private final String ffmpeg;

    public ShotCandidateService(ProjectRepository projects, ProjectSceneRepository scenes,
                                ProjectOperationLock operations, ProjectSourceSnapshots snapshots,
                                ProjectFilmConfig configs, ProjectFilmRenderer renderer, ObjectMapper json,
                                @Value("${fengmotion.asset.ffmpeg:ffmpeg}") String ffmpeg) {
        this.projects = projects;
        this.scenes = scenes;
        this.operations = operations;
        this.snapshots = snapshots;
        this.configs = configs;
        this.renderer = renderer;
        this.json = json;
        this.ffmpeg = ffmpeg;
    }

    public PreviewResult preview(String projectId, ShotCandidateRequest request) {
        validateRequest(request);
        operations.acquire(projectId);
        try {
            return previewUnlocked(projectId, request);
        } finally {
            operations.release(projectId);
        }
    }

    private PreviewResult previewUnlocked(String projectId, ShotCandidateRequest request) {
        Project project = project(projectId);
        ProjectSceneVersion base = requireCurrentVersion(projectId, request.baseVersion(), request.sourceHash());
        Path root = projectRoot(project);
        requireWorkingSource(root, request.sourceHash());
        Path source = snapshots.resolve(root, base.film().path("sourceSnapshot").asText(), request.sourceHash());
        ProjectFilmConfig.FilmConfig baseConfig = requireShotConfig(source);
        requireRecordedTimeline(base.film(), baseConfig);
        ShotTimeline.Shot target = findShot(baseConfig.shotTimeline(), request.shotId());
        String candidateId = request.requestId();
        String requestHash = requestHash(request);
        Path candidateDirectory = candidateDirectory(root, candidateId);
        removeExpiredCandidates(candidateDirectory.getParent());

        if (Files.exists(candidateDirectory, LinkOption.NOFOLLOW_LINKS)) {
            ObjectNode existing = readCandidate(candidateDirectory, projectId, candidateId, request.baseVersion());
            if (existing != null) {
                if (!requestHash.equals(existing.path("requestHash").asText())) {
                    throw conflict("candidate_request_conflict", "该请求 ID 已用于不同的镜头候选稿");
                }
                if ("ready".equals(existing.path("status").asText())
                        || "committed".equals(existing.path("status").asText())) {
                    if (!sha256(readSource(candidateDirectory).getBytes(StandardCharsets.UTF_8))
                            .equals(existing.path("componentSha256").asText())) {
                        throw conflict("shot_candidate_changed", "候选组件内容已变化，请重新生成预览");
                    }
                    return previewResult(existing);
                }
            }
            deleteTree(candidateDirectory);
        }

        Path candidatesRoot = candidateDirectory.getParent();
        try {
            Files.createDirectories(candidatesRoot);
            Files.createDirectory(candidateDirectory);
            try (ProjectSourceSnapshots.Workspace workspace = snapshots.createWorkspace(root,
                    base.film().path("sourceSnapshot").asText(), request.sourceHash())) {
                String sourceId = sourceId(candidateId);
                ProjectFilmConfig.FilmConfig updatedConfig = stageCandidate(workspace.path(), baseConfig,
                        target.id(), sourceId, request.componentSource());
                String candidateHash = ProjectSourceFingerprint.compute(workspace.path());
                ShotTimeline.Shot previewShot = new ShotTimeline.Shot(target.id(), sourceId,
                        target.label(), 0, target.frames());
                String previewVoice = updatedConfig.shotTimeline().voiceover() == null
                        ? null : extractVoiceover(workspace.path(), updatedConfig.shotTimeline(), target);
                ShotTimeline previewTimeline = new ShotTimeline(updatedConfig.shotTimeline().width(),
                        updatedConfig.shotTimeline().height(), updatedConfig.shotTimeline().fps(),
                        target.frames(), List.of(previewShot), previewVoice);
                ProjectFilmConfig.FilmConfig previewConfig = new ProjectFilmConfig.FilmConfig(
                        ShotTimeline.ENTRY, ShotTimeline.COMPOSITION, previewTimeline.width(),
                        previewTimeline.height(), previewTimeline.fps(), previewTimeline);
                Path previewPath = candidateDirectory.resolve("preview.mp4");
                ProjectFilmRenderer.Result rendered = renderer.render(workspace.path(), previewConfig, previewPath);
                CreationCancellation.requireRunning();
                verifyRender(previewTimeline, rendered, "镜头预览渲染规格与候选槽位不一致");
                String relativePreview = root.relativize(previewPath).toString().replace('\\', '/');
                VideoTimeline.write(json, previewPath, relativePreview, rendered.sequences(),
                        rendered.durationInFrames(), rendered.fps(), candidateHash, false);

                ObjectNode metadata = json.createObjectNode()
                        .put("schemaVersion", 1)
                        .put("projectId", projectId)
                        .put("candidateId", candidateId)
                        .put("requestHash", requestHash)
                        .put("status", "ready")
                        .put("baseVersion", request.baseVersion())
                        .put("baseSourceHash", request.sourceHash())
                        .put("candidateSourceHash", candidateHash)
                        .put("shotId", target.id())
                        .put("sourceId", sourceId)
                        .put("prompt", request.prompt() == null ? "" : request.prompt())
                        .put("previewPath", relativePreview)
                        .put("durationInFrames", rendered.durationInFrames())
                        .put("width", rendered.width())
                        .put("height", rendered.height())
                        .put("fps", rendered.fps())
                        .put("hasVoiceover", previewVoice != null)
                        .put("createdAt", Instant.now().toString());
                writeSource(candidateDirectory, request.componentSource());
                CreationCancellation.requireRunning();
                writeMetadata(candidateDirectory, metadata);
                return previewResult(metadata);
            }
        } catch (RuntimeException | IOException failure) {
            deleteTree(candidateDirectory);
            if (failure instanceof RuntimeException runtime) throw runtime;
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "shot_candidate_store_failed",
                    "无法保存镜头候选稿及预览");
        }
    }

    public PreviewFile previewFile(String projectId, long version, String candidateId) {
        validateCandidateId(candidateId);
        Project project = project(projectId);
        Path directory = candidateDirectory(projectRoot(project), candidateId);
        ObjectNode metadata = readCandidate(directory, projectId, candidateId, version);
        if (metadata == null || !"ready".equals(metadata.path("status").asText())
                && !"committed".equals(metadata.path("status").asText())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "shot_candidate_not_found", "镜头候选预览不存在");
        }
        String artifactPath = metadata.path("previewPath").asText("");
        Path video = VideoTimeline.projectVideo(project.rootPath(), artifactPath);
        JsonNode manifest = VideoTimeline.read(json, video, artifactPath).orElseThrow(() ->
                new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_candidate_preview_invalid", "镜头候选预览清单不可用"));
        if (!metadata.path("candidateSourceHash").asText().equals(manifest.path("sourceHash").asText())
                || Math.abs(manifest.path("durationSeconds").asDouble() * manifest.path("fps").asDouble()
                    - metadata.path("durationInFrames").asInt()) > 0.000001) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_candidate_preview_invalid", "候选预览与候选源码指纹不一致");
        }
        try {
            return new PreviewFile(video, Files.size(video));
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.NOT_FOUND, "shot_candidate_not_found", "镜头候选预览不存在");
        }
    }

    public Optional<PreviewResult> existingPreview(String projectId,ShotCandidateRequest request) {
        validateRequest(request);
        Path root=projectRoot(project(projectId));
        ObjectNode metadata=readCandidate(candidateDirectory(root,request.requestId()),projectId,request.requestId(),request.baseVersion());
        if(metadata==null) return Optional.empty();
        if(!requestHash(request).equals(metadata.path("requestHash").asText())) throw conflict("task_idempotency_conflict","候选身份与请求不一致");
        previewFile(projectId,request.baseVersion(),request.requestId());
        return Optional.of(previewResult(metadata));
    }

    public Optional<CommitResult> existingCommit(String projectId,long version,String candidateId) {
        validateCandidateId(candidateId);
        var stored=scenes.findVersionByShotCandidate(projectId,candidateId);
        if(stored.isEmpty()) return Optional.empty();
        var film=stored.get().film();
        var shot=film.path("shotEdit");
        var output=film.path("output");
        Path root=projectRoot(project(projectId));
        var metadata=readCandidate(candidateDirectory(root,candidateId),projectId,candidateId,version);
        long recordedBase=shot.path("baseVersion").asLong(-1);
        if(recordedBase>=0 && (!shot.path("baseVersion").isIntegralNumber() || recordedBase!=version)) throw conflict("task_idempotency_conflict","候选提交记录不属于请求的基础版本");
        if(recordedBase<0 && metadata==null) return Optional.empty();
        if(!candidateId.equals(shot.path("candidateId").asText()) || !sourceId(candidateId).equals(shot.path("sourceId").asText())
                || !shot.path("shotId").asText().matches("[a-z][a-z0-9_-]{0,63}")
                || !validSourceHash(film.path("sourceHash").asText()) || stored.get().artifactPath()==null
                || output.path("durationInFrames").asInt()<1 || output.path("width").asInt()<1 || output.path("height").asInt()<1
                || output.path("fps").asDouble()<1) {
            throw conflict("shot_candidate_invalid","候选提交凭据无效");
        }
        return Optional.of(new CommitResult(projectId,candidateId,stored.get().version(),stored.get().artifactPath(),film.path("sourceHash").asText(),
                shot.path("shotId").asText(),shot.path("sourceId").asText(),output.path("durationInFrames").asInt(),output.path("width").asInt(),output.path("height").asInt(),output.path("fps").asDouble()));
    }

    public CommitResult commit(String projectId, long version, String candidateId) {
        validateCandidateId(candidateId);
        operations.acquire(projectId);
        try {
            return commitUnlocked(projectId, version, candidateId);
        } finally {
            operations.release(projectId);
        }
    }

    private CommitResult commitUnlocked(String projectId, long version, String candidateId) {
        Project project = project(projectId);
        Path root = projectRoot(project);
        Path candidateDirectory = candidateDirectory(root, candidateId);
        var authoritative = existingCommit(projectId, version, candidateId);
        if (authoritative.isPresent()) return authoritative.get();
        ObjectNode candidate = readCandidate(candidateDirectory, projectId, candidateId, version);
        if (candidate == null) throw new ApiException(HttpStatus.NOT_FOUND, "shot_candidate_not_found", "镜头候选稿不存在");

        if ("committed".equals(candidate.path("status").asText())) {
            throw conflict("shot_candidate_commit_missing", "候选标记已提交但数据库没有对应版本，未重复制作，请核对历史");
        }
        ProjectSceneVersion base = requireCurrentVersion(projectId, version, candidate.path("baseSourceHash").asText());

        String baseHash = candidate.path("baseSourceHash").asText();
        if (!sourceId(candidateId).equals(candidate.path("sourceId").asText())
                || !candidate.path("shotId").asText().matches("[a-z][a-z0-9_-]{0,63}")) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_candidate_invalid", "候选稿元数据无效");
        }
        requireWorkingSource(root, baseHash);
        String snapshotReference = base.film().path("sourceSnapshot").asText();
        Path baseSnapshot = snapshots.resolve(root, snapshotReference, baseHash);
        ProjectFilmConfig.FilmConfig baseConfig = requireShotConfig(baseSnapshot);
        requireRecordedTimeline(base.film(), baseConfig);
        ShotTimeline.Shot target = findShot(baseConfig.shotTimeline(), candidate.path("shotId").asText());
        String sourceId = candidate.path("sourceId").asText();
        String componentSource = readSource(candidateDirectory);
        if (!sha256(componentSource.getBytes(StandardCharsets.UTF_8))
                .equals(candidate.path("componentSha256").asText())) {
            throw new ApiException(HttpStatus.CONFLICT, "shot_candidate_changed", "候选组件内容已变化，请重新生成预览");
        }

        Path output = root.resolve("renders").resolve("project-shot-" + candidateId + ".mp4");
        requireRenderDirectory(root);
        String artifactPath = "renders/" + output.getFileName();
        String newSnapshot = null;
        boolean committed = false;
        try (ProjectSourceSnapshots.Workspace workspace = snapshots.createWorkspace(root, snapshotReference, baseHash)) {
            ProjectFilmConfig.FilmConfig nextConfig = stageCandidate(workspace.path(), baseConfig,
                    target.id(), sourceId, componentSource);
            String newHash = ProjectSourceFingerprint.compute(workspace.path());
            if (!newHash.equals(candidate.path("candidateSourceHash").asText())) {
                throw new ApiException(HttpStatus.CONFLICT, "shot_candidate_changed", "候选工程与预览时内容不一致，请重新生成预览");
            }
            newSnapshot = snapshots.capture(root, workspace.path());
            Path captured = snapshots.resolve(root, newSnapshot, newHash);
            ProjectFilmConfig.FilmConfig capturedConfig = requireShotConfig(captured);
            Instant started = Instant.now();
            ProjectFilmRenderer.Result rendered = renderer.render(captured, capturedConfig, output);
            verifyRender(capturedConfig.shotTimeline(), rendered, "成片渲染规格与镜头清单不一致");
            long renderMs = Duration.between(started, Instant.now()).toMillis();
            VideoTimeline.write(json, output, artifactPath, rendered.sequences(), rendered.durationInFrames(),
                    rendered.fps(), newHash, false);

            ObjectNode updatedFilm = ((ObjectNode) base.film()).deepCopy();
            updatedFilm.put("entry", capturedConfig.entry())
                    .put("compositionId", capturedConfig.compositionId())
                    .put("sourceSnapshot", newSnapshot)
                    .put("sourceHash", newHash);
            updatedFilm.set("shotTimeline", json.valueToTree(capturedConfig.shotTimeline()));
            updatedFilm.set("sources", ProjectFilmRenderService.sourceEntries(json, captured));
            updatedFilm.set("dependencies", rendered.dependencies() != null && rendered.dependencies().isObject()
                    ? rendered.dependencies().deepCopy() : json.createObjectNode());
            ObjectNode outputMetadata = updatedFilm.path("output").isObject()
                    ? (ObjectNode) updatedFilm.path("output") : updatedFilm.putObject("output");
            outputMetadata.put("durationInFrames", rendered.durationInFrames())
                    .put("width", rendered.width()).put("height", rendered.height())
                    .put("fps", rendered.fps()).put("renderMs", renderMs);
            updatedFilm.putObject("shotEdit").put("candidateId", candidateId)
                    .put("shotId", target.id()).put("sourceId", sourceId).put("baseVersion", version);

            CreationCancellation.requireRunning();
            try (var write = com.fengmotion.server.project.service.SourceWriteGuard.acquire(root)) {
            requireWorkingSource(root, baseHash);
            try (ProjectSourceSnapshots.Recovery recovery = snapshots.restore(root, newSnapshot, newHash)) {
                try {
                CreationCancellation.requireRunning();
                Optional<Long> nextVersion = SceneCommitVerifier.commit(scenes,projectId,version,updatedFilm,artifactPath,()->scenes.commitWithSnapshot(projectId, version, updatedFilm, null,
                        candidate.path("prompt").asText(""), "替换镜头 " + target.id(), artifactPath,
                        ProjectSceneVersion.SOURCE_SHOT_EDIT, null));
                if (nextVersion.isEmpty()) throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict",
                        "项目在提交镜头候选期间已更新，本次结果未提交");
                recovery.commit();
                ObjectNode saved = candidate.deepCopy().put("status", "committed")
                        .put("committedVersion", nextVersion.get()).put("artifactPath", artifactPath)
                        .put("sourceHash", newHash).put("durationInFrames", rendered.durationInFrames())
                        .put("width", rendered.width()).put("height", rendered.height()).put("fps", rendered.fps());
                try { writeMetadata(candidateDirectory, saved); } catch (IOException error) {
                    log.warn("候选稿已提交，但幂等元数据未写入：{}", candidateId, error);
                }
                committed = true;
                return committedResult(saved);
                } catch(RuntimeException failure) {
                    if(SceneCommitVerifier.uncertain(failure)) { recovery.retainPending();committed=true; }
                    throw failure;
                }
            } catch (IOException failure) {
                throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "shot_candidate_rollback_failed",
                        "镜头候选提交失败，工作区恢复未完成");
            }
            }
        } finally {
            if (!committed) {
                cleanupOutput(output);
                if (newSnapshot != null) snapshots.discard(root, newSnapshot);
            }
        }
    }

    public void discard(String projectId, long version, String candidateId) {
        validateCandidateId(candidateId);
        operations.acquire(projectId);
        try {
            Path directory = candidateDirectory(projectRoot(project(projectId)), candidateId);
            if (scenes.findVersionByShotCandidate(projectId,candidateId).isPresent()) {
                throw conflict("shot_candidate_already_committed", "已提交的镜头版本不能作为候选放弃");
            }
            ObjectNode candidate = readCandidate(directory, projectId, candidateId, version);
            if (candidate == null) return;
            if ("committed".equals(candidate.path("status").asText()) || scenes.findVersionByShotCandidate(projectId,candidateId).isPresent()) {
                throw conflict("shot_candidate_already_committed", "已提交的镜头版本不能作为候选放弃");
            }
            deleteTree(directory);
        } finally {
            operations.release(projectId);
        }
    }

    private Project project(String projectId) {
        return projects.findById(projectId).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
    }

    private static Path projectRoot(Project project) {
        if (project.rootPath() == null || project.rootPath().isBlank()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "project_directory_missing", "项目没有工程目录");
        }
        return Path.of(project.rootPath()).toAbsolutePath().normalize();
    }

    private ProjectSceneVersion requireCurrentVersion(String projectId, long version, String sourceHash) {
        ProjectScene current = scenes.find(projectId).filter(ProjectScene::present).orElseThrow(() ->
                new ApiException(HttpStatus.CONFLICT, "scene_not_initialized", "项目还没有已提交的场景版本"));
        if (current.version() != version) {
            throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict", "场景已更新，请刷新后重新生成候选稿");
        }
        ProjectSceneVersion saved = scenes.findVersion(projectId, version).orElseThrow(() ->
                new ApiException(HttpStatus.CONFLICT, "scene_version_conflict", "当前版本快照不存在"));
        JsonNode film = saved.film();
        if (film == null || !"project-render".equals(film.path("kind").asText())
                || !film.path("shotTimeline").path("shots").isArray()
                || film.path("shotTimeline").path("shots").isEmpty()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_edit_unavailable", "当前版本不是镜头装配工程");
        }
        if (sourceHash == null || !sourceHash.equals(film.path("sourceHash").asText())) {
            throw new ApiException(HttpStatus.CONFLICT, "source_version_conflict", "工程源码版本已变化，请重新读取后重试");
        }
        return saved;
    }

    private ProjectFilmConfig.FilmConfig requireShotConfig(Path root) {
        ProjectFilmConfig.FilmConfig config = configs.read(root);
        if (config.shotTimeline() == null) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_edit_unavailable", "工程没有受支持的镜头清单");
        }
        return config;
    }

    private void requireRecordedTimeline(JsonNode film, ProjectFilmConfig.FilmConfig config) {
        if (film == null || !json.valueToTree(config.shotTimeline()).equals(film.path("shotTimeline"))) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_timeline_mismatch",
                    "源码快照中的镜头清单与该版本记录不一致");
        }
    }

    private static ShotTimeline.Shot findShot(ShotTimeline timeline, String id) {
        return timeline.shots().stream().filter(shot -> shot.id().equals(id)).findFirst().orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "shot_not_found", "当前版本不存在镜头 " + id));
    }

    private ProjectFilmConfig.FilmConfig stageCandidate(Path root, ProjectFilmConfig.FilmConfig base,
                                                         String shotId, String sourceId, String componentSource) {
        Path component = root.resolve("src/shots").resolve(sourceId + ".tsx");
        if (Files.exists(component, LinkOption.NOFOLLOW_LINKS)) {
            throw conflict("shot_source_exists", "候选组件 ID 已存在");
        }
        try {
            Files.createDirectories(component.getParent());
            Files.writeString(component, componentSource, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            Path configFile = root.resolve(ProjectFilmConfig.FILE_NAME);
            JsonNode loaded = json.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY,
                    com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(Files.readString(configFile));
            if (loaded == null || !loaded.isObject() || !loaded.path("shots").isArray()) throw invalidTimeline();
            ObjectNode config = (ObjectNode) loaded;
            ArrayNode shots = (ArrayNode) config.path("shots");
            boolean found = false;
            for (JsonNode item : shots) {
                if (shotId.equals(item.path("id").asText())) {
                    ((ObjectNode) item).put("sourceId", sourceId);
                    found = true;
                    break;
                }
            }
            if (!found) throw new ApiException(HttpStatus.CONFLICT, "shot_not_found", "候选目标镜头已不存在");
            Files.write(configFile, json.writeValueAsBytes(config), StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE);
            ProjectFilmConfig.FilmConfig updated = requireShotConfig(root);
            if (updated.shotTimeline().durationInFrames() != base.shotTimeline().durationInFrames()
                    || updated.shotTimeline().fps() != base.shotTimeline().fps()
                    || updated.shotTimeline().width() != base.shotTimeline().width()
                    || updated.shotTimeline().height() != base.shotTimeline().height()) throw invalidTimeline();
            return updated;
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_timeline_invalid", "无法更新隔离副本中的镜头清单");
        }
    }

    private String extractVoiceover(Path root, ShotTimeline timeline, ShotTimeline.Shot shot) {
        Path input = root.resolve("public").resolve(timeline.voiceover()).normalize();
        Path output = root.resolve("public/voiceover.wav");
        Path logFile = null;
        Path stagedInput = null;
        if (!input.startsWith(root) || Files.isSymbolicLink(input)
                || !Files.isRegularFile(input, LinkOption.NOFOLLOW_LINKS)) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_voiceover_invalid", "旁白文件不可用于候选预览");
        }
        try {
            Files.createDirectories(output.getParent());
            stagedInput = output.getParent().resolve(".candidate-voice-" + UUID.randomUUID()
                    + input.getFileName().toString().substring(input.getFileName().toString().lastIndexOf('.')));
            Files.copy(input, stagedInput);
            logFile = Files.createTempFile("fm-shot-audio-", ".log");
            double start = shot.startFrame() / (double) timeline.fps();
            double duration = shot.frames() / (double) timeline.fps();
            List<String> command = List.of(ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                    "-i", stagedInput.toString(), "-ss", Double.toString(start), "-t", Double.toString(duration),
                    "-vn", "-af", "apad,atrim=duration=" + duration, "-ac", "2", "-ar", "48000",
                    "-c:a", "pcm_s16le", output.toString());
            Process process = new ProcessBuilder(command).redirectError(logFile.toFile()).start();
            boolean finished;
            try {
                finished = process.waitFor(AUDIO_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                process.destroyForcibly();
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "shot_audio_interrupted", "准备候选旁白时被中断");
            }
            if (!finished) {
                process.destroyForcibly();
                throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "shot_audio_timeout", "准备候选旁白超时");
            }
            if (process.exitValue() != 0 || !Files.isRegularFile(output, LinkOption.NOFOLLOW_LINKS)) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_audio_unavailable", "无法截取该镜头对应的旁白");
            }
            return "voiceover.wav";
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "shot_audio_unavailable", "本机 ffmpeg 不可用，无法生成带旁白的候选预览");
        } finally {
            if (logFile != null) try { Files.deleteIfExists(logFile); } catch (IOException ignored) { }
            if (stagedInput != null) try { Files.deleteIfExists(stagedInput); } catch (IOException ignored) { }
        }
    }

    private static void verifyRender(ShotTimeline expected, ProjectFilmRenderer.Result rendered, String message) {
        if (rendered.durationInFrames() != expected.durationInFrames() || rendered.width() != expected.width()
                || rendered.height() != expected.height() || Math.abs(rendered.fps() - expected.fps()) > 0.000001) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_render_mismatch", message);
        }
    }

    private ObjectNode readCandidate(Path directory, String projectId, String candidateId, long version) {
        Path metadataPath = directory.resolve(METADATA_NAME);
        try {
            if (Files.isSymbolicLink(directory) || Files.isSymbolicLink(metadataPath)
                    || !Files.isRegularFile(metadataPath, LinkOption.NOFOLLOW_LINKS)
                    || Files.size(metadataPath) > MAX_METADATA_BYTES) return null;
            JsonNode node = json.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY,
                    com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(Files.readString(metadataPath));
            if (!node.isObject() || node.path("schemaVersion").asInt() != 1
                    || !projectId.equals(node.path("projectId").asText())
                    || !candidateId.equals(node.path("candidateId").asText())
                    || node.path("baseVersion").asLong(-1) != version
                    || !sourceId(candidateId).equals(node.path("sourceId").asText())
                    || !node.path("shotId").asText().matches("[a-z][a-z0-9_-]{0,63}")
                    || !validSourceHash(node.path("baseSourceHash").asText())
                    || !validSourceHash(node.path("candidateSourceHash").asText())
                    || !node.path("requestHash").asText().matches("[0-9a-f]{64}")
                    || !node.path("componentSha256").asText().matches("[0-9a-f]{64}")
                    || !("ready".equals(node.path("status").asText())
                        || "committed".equals(node.path("status").asText()))
                    || !node.path("previewPath").asText().equals(DIRECTORY + "/" + candidateId + "/preview.mp4")) return null;
            return (ObjectNode) node;
        } catch (IOException | RuntimeException invalid) {
            return null;
        }
    }

    private static Path candidateDirectory(Path root, String candidateId) {
        validateCandidateId(candidateId);
        Path control = root.resolve(".fengmotion");
        Path candidates = control.resolve("shot-candidates");
        if (Files.isSymbolicLink(root) || Files.isSymbolicLink(control) || Files.isSymbolicLink(candidates)) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_candidate_store_invalid", "候选稿目录不能是符号链接");
        }
        Path result = candidates.resolve(candidateId).normalize();
        if (!result.getParent().equals(candidates.normalize())) throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "候选稿 ID 无效");
        return result;
    }

    private PreviewResult previewResult(ObjectNode candidate) {
        return new PreviewResult(candidate.path("projectId").asText(), candidate.path("candidateId").asText(),
                candidate.path("baseVersion").asLong(), candidate.path("baseSourceHash").asText(),
                candidate.path("shotId").asText(), candidate.path("sourceId").asText(),
                candidate.path("durationInFrames").asInt(), candidate.path("width").asInt(),
                candidate.path("height").asInt(), candidate.path("fps").asDouble(),
                candidate.path("hasVoiceover").asBoolean());
    }

    private static CommitResult committedResult(ObjectNode candidate) {
        return new CommitResult(candidate.path("projectId").asText(), candidate.path("candidateId").asText(),
                candidate.path("committedVersion").asLong(), candidate.path("artifactPath").asText(),
                candidate.path("sourceHash").asText(), candidate.path("shotId").asText(),
                candidate.path("sourceId").asText(), candidate.path("durationInFrames").asInt(),
                candidate.path("width").asInt(), candidate.path("height").asInt(), candidate.path("fps").asDouble());
    }

    private static void validateRequest(ShotCandidateRequest request) {
        if (request == null || request.baseVersion() == null || request.baseVersion() < 1
                || request.sourceHash() == null || !request.sourceHash().matches("files=\\d+;sha256=(?:[0-9a-f]{64}|empty)")
                || request.shotId() == null || !request.shotId().matches("[a-z][a-z0-9_-]{0,63}")
                || request.componentSource() == null || request.componentSource().isBlank()
                || request.componentSource().getBytes(StandardCharsets.UTF_8).length > MAX_SOURCE_BYTES
                || (request.prompt() != null && request.prompt().length() > 4000)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "需要有效的 baseVersion、sourceHash、shotId 和 componentSource；源码上限 256 KiB，prompt 上限 4000 字符");
        }
        validateCandidateId(request.requestId());
    }

    private static void validateCandidateId(String id) {
        try {
            if (id == null || !UUID.fromString(id).toString().equalsIgnoreCase(id)) throw new IllegalArgumentException();
        } catch (RuntimeException invalid) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "requestId/candidateId 必须是 UUID");
        }
    }

    private static String sourceId(String candidateId) {
        return "fm-candidate-" + candidateId.replace("-", "").toLowerCase();
    }

    private static boolean validSourceHash(String value) {
        return value != null && value.matches("files=\\d+;sha256=(?:[0-9a-f]{64}|empty)");
    }

    private String requestHash(ShotCandidateRequest request) {
        String sourceHash = sha256(request.componentSource().getBytes(StandardCharsets.UTF_8));
        return sha256((request.baseVersion() + "\0" + request.sourceHash() + "\0" + request.shotId()
                + "\0" + sourceHash + "\0" + (request.prompt() == null ? "" : request.prompt()))
                .getBytes(StandardCharsets.UTF_8));
    }

    private static String sha256(byte[] content) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content)); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private void writeSource(Path directory, String source) throws IOException {
        Path path = directory.resolve(SOURCE_NAME);
        Files.writeString(path, source, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
    }

    private String readSource(Path directory) {
        Path source = directory.resolve(SOURCE_NAME);
        try {
            if (Files.isSymbolicLink(source) || !Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS)
                    || Files.size(source) > MAX_SOURCE_BYTES) throw new IOException("invalid candidate source");
            return Files.readString(source, StandardCharsets.UTF_8);
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_candidate_invalid", "候选组件源文件缺失或无效");
        }
    }

    private void writeMetadata(Path directory, ObjectNode metadata) throws IOException {
        String componentHash = sha256(readSource(directory).getBytes(StandardCharsets.UTF_8));
        metadata.put("componentSha256", componentHash);
        byte[] bytes = json.writeValueAsBytes(metadata);
        if (bytes.length > MAX_METADATA_BYTES) throw new IOException("candidate metadata too large");
        Path staged = Files.createTempFile(directory, ".candidate-", ".tmp");
        try {
            Files.write(staged, bytes, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
            Files.move(staged, directory.resolve(METADATA_NAME), StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(staged);
        }
    }

    private static void requireWorkingSource(Path root, String expected) {
        if (!expected.equals(ProjectSourceFingerprint.compute(root))) {
            throw conflict("working_source_conflict", "工作区源码与候选基线不同；先保存或渲染工作稿，再重新生成候选");
        }
    }

    private static void requireRenderDirectory(Path root) {
        Path renders = root.resolve("renders");
        if ((Files.exists(renders, LinkOption.NOFOLLOW_LINKS) && !Files.isDirectory(renders, LinkOption.NOFOLLOW_LINKS))
                || Files.isSymbolicLink(renders)) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "render_directory_invalid", "项目产物目录无效");
        }
    }

    private void removeExpiredCandidates(Path candidatesRoot) {
        if (!Files.isDirectory(candidatesRoot, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(candidatesRoot)) return;
        Instant cutoff = Instant.now().minus(Duration.ofDays(7));
        try (var entries = Files.list(candidatesRoot)) {
            for (Path entry : entries.toList()) {
                if (Files.isSymbolicLink(entry) || !Files.isDirectory(entry, LinkOption.NOFOLLOW_LINKS)) continue;
                Path metadata = entry.resolve(METADATA_NAME);
                if (Files.isSymbolicLink(metadata) || !Files.isRegularFile(metadata, LinkOption.NOFOLLOW_LINKS)
                        || Files.size(metadata) > MAX_METADATA_BYTES) continue;
                JsonNode value = json.readTree(Files.readString(metadata));
                if (!"ready".equals(value.path("status").asText())) continue;
                Instant created = Instant.parse(value.path("createdAt").asText());
                if (created.isBefore(cutoff)) deleteTree(entry);
            }
        } catch (Exception failure) {
            log.warn("清理过期镜头候选稿失败：{}", candidatesRoot, failure);
        }
    }

    private static ApiException invalidTimeline() {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_timeline_invalid", "修改后的镜头装配清单无效");
    }

    private static ApiException conflict(String code, String message) {
        return new ApiException(HttpStatus.CONFLICT, code, message);
    }

    private static void cleanupOutput(Path output) {
        try { VideoTimeline.discard(output); }
        catch (IOException failure) { log.warn("未提交镜头候选产物清理失败：{}", output, failure); }
    }

    private static void deleteTree(Path directory) {
        if (directory == null || !Files.exists(directory, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(directory)) return;
        try (var paths = Files.walk(directory)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
        } catch (IOException failure) {
            log.warn("镜头候选文件清理失败：{}", directory, failure);
        }
    }

    public record PreviewResult(String projectId, String candidateId, long baseVersion, String sourceHash,
                                String shotId, String sourceId, int durationInFrames,
                                int width, int height, double fps, boolean hasVoiceover) { }
    public record PreviewFile(Path path, long size) { }
    public record CommitResult(String projectId, String candidateId, long version, String artifactPath,
                               String sourceHash, String shotId, String sourceId,
                               int durationInFrames, int width, int height, double fps) { }
}
