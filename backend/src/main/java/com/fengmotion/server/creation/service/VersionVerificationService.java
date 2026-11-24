package com.fengmotion.server.creation.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.VideoTimeline;
import com.fengmotion.server.render.service.VideoTimelineProbe;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class VersionVerificationService {
    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ProjectOperationLock operations;
    private final ProjectSourceSnapshots snapshots;
    private final ProjectFilmConfig configs;
    private final VideoTimelineProbe probe;
    private final ObjectMapper json;

    public Report verify(String projectId, long version) {
        if (version < 1) throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "需要有效版本号");
        try (var activity = operations.participate(projectId)) {
            var project = projects.findById(projectId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
            var saved = scenes.findVersion(projectId, version).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "版本不存在"));
            CreationCancellation.requireRunning();
            List<Check> checks = new ArrayList<>();
            String videoHash = null;
            JsonNode film = saved.film();
            Path video = null;
            try {
                video = VideoTimeline.projectVideo(project.rootPath(), saved.artifactPath());
                if (Files.size(video) == 0) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "video_empty", "视频文件为空");
                videoHash = VideoTimeline.videoHash(video);
                checks.add(new Check("video", "passed", "video_readable", "版本视频可读取，SHA-256=" + videoHash));
            } catch (ApiException failure) { checks.add(failed("video", failure)); }
            catch (IOException failure) { checks.add(new Check("video", "not_run", "video_unreadable", "视频无法读取")); }
            if (video != null && videoHash != null) {
                try {
                    var specification = specification(film);
                    probe.verify(video, specification.frames(), specification.fps(), specification.width(), specification.height());
                    checks.add(new Check("media", "passed", "media_matches", "实际视频帧数、帧率、时长和画布与版本记录一致"));
                } catch (ApiException failure) {
                    checks.add(new Check("media", failure.getCode().equals("timeline_probe_failed") || failure.getCode().equals("process_output_too_large")
                            ? "not_run" : "failed", failure.getCode(), failure.getMessage()));
                }
                CreationCancellation.requireRunning();
                try {
                    JsonNode timeline = VideoTimeline.read(json, video, saved.artifactPath()).orElseThrow(() ->
                            new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "timeline_missing", "没有绑定此视频的轨道清单"));
                    if (film != null && film.hasNonNull("sourceHash") && !film.path("sourceHash").asText().equals(timeline.path("sourceHash").asText())) {
                        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "timeline_source_mismatch", "轨道源码指纹与版本不一致");
                    }
                    var specification = specification(film);
                    if (Math.abs(timeline.path("fps").asDouble() - specification.fps()) > 0.000001
                            || Math.abs(timeline.path("durationSeconds").asDouble() - specification.frames() / specification.fps()) > 0.000001) {
                        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "timeline_version_mismatch", "轨道时序与版本不一致");
                    }
                    checks.add(new Check("timeline", "passed", "timeline_bound", "轨道格式、视频摘要及版本时序一致"));
                } catch (ApiException failure) { checks.add(failed("timeline", failure)); }
            } else {
                checks.add(new Check("media", "not_run", "video_unavailable", "视频不可用，未执行媒体核验"));
                checks.add(new Check("timeline", "not_run", "video_unavailable", "视频不可用，未核验轨道绑定"));
            }
            CreationCancellation.requireRunning();
            if (film != null && "project-render".equals(film.path("kind").asText())) {
                try {
                    String hash = film.path("sourceHash").textValue();
                    String reference = film.path("sourceSnapshot").textValue();
                    if (hash == null || hash.isBlank() || reference == null || reference.isBlank()) throw new ApiException(
                            HttpStatus.UNPROCESSABLE_ENTITY, "source_snapshot_unavailable", "此版本没有完整源码快照凭据");
                    Path source = snapshots.resolve(Path.of(project.rootPath()), reference, hash);
                    var config = configs.read(source);
                    if (!config.entry().equals(film.path("entry").asText()) || !config.compositionId().equals(film.path("compositionId").asText())) {
                        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "snapshot_corrupt", "快照入口与版本不一致");
                    }
                    checks.add(new Check("source", "passed", "source_verified", "快照摘要与入口匹配该版本"));
                } catch (ApiException failure) { checks.add(failed("source", failure)); }
            } else checks.add(new Check("source", "not_applicable", "scene_data", "此版本使用场景数据，不依赖源码快照"));
            if (videoHash != null) {
                try {
                    if (!videoHash.equals(VideoTimeline.videoHash(video))) throw new ApiException(HttpStatus.CONFLICT,
                            "verification_changed", "核验期间视频发生变化，结果已作废，请重新执行");
                } catch (IOException failure) { throw new ApiException(HttpStatus.CONFLICT, "verification_changed", "核验期间视频不可读取"); }
            }
            CreationCancellation.requireRunning();
            String conclusion = checks.stream().anyMatch(check -> check.status().equals("failed")) ? "failed"
                    : checks.stream().anyMatch(check -> check.status().equals("not_run")) ? "not_run" : "passed";
            return new Report(projectId, version, saved.artifactPath(), videoHash, "technical-integrity-v1", conclusion,
                    "not_run", List.copyOf(checks), Instant.now().toString());
        }
    }

    private Specification specification(JsonNode film) {
        if (film == null || !film.isObject()) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "scene_corrupt", "版本内容损坏");
        boolean rendered = "project-render".equals(film.path("kind").asText());
        JsonNode values = rendered ? film.path("output") : film;
        int frames;
        if (rendered) {
            if (!values.path("durationInFrames").isIntegralNumber() || !values.path("durationInFrames").canConvertToInt()) throw invalidSpecification();
            frames = values.path("durationInFrames").intValue();
        }
        else {
            JsonNode timeline = VideoTimeline.fromFilm(json, film);
            frames = (int) Math.round(timeline.path("durationSeconds").asDouble() * timeline.path("fps").asDouble());
        }
        double fps = values.path("fps").asDouble();
        int width = values.path("width").asInt();
        int height = values.path("height").asInt();
        if (frames < 1 || !values.path("fps").isNumber() || !Double.isFinite(fps) || fps < 1 || fps > 240
                || !values.path("width").isIntegralNumber() || !values.path("height").isIntegralNumber()
                || width < 1 || height < 1) throw invalidSpecification();
        return new Specification(frames, fps, width, height);
    }

    private static Check failed(String check, ApiException failure) { return new Check(check, "failed", failure.getCode(), failure.getMessage()); }
    private static ApiException invalidSpecification() {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "scene_specification_invalid", "版本缺少有效媒体规格");
    }
    private record Specification(int frames, double fps, int width, int height) { }
    public record Check(String check, String status, String code, String evidence) { }
    public record Report(String projectId, long version, String artifactPath, String videoHash, String scope,
                         String conclusion, String visualReview, List<Check> checks, String checkedAt) { }
}
