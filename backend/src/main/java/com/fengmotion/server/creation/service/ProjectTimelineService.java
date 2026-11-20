package com.fengmotion.server.creation.service;

import java.io.IOException;
import java.nio.file.Path;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.service.ProjectSourceFingerprint;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.ProjectFilmRenderer;
import com.fengmotion.server.render.service.VideoTimeline;
import com.fengmotion.server.render.service.VideoTimelineProbe;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class ProjectTimelineService {
    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ProjectOperationLock operations;
    private final ProjectSourceSnapshots snapshots;
    private final ProjectFilmConfig configs;
    private final ProjectFilmRenderer renderer;
    private final VideoTimelineProbe probe;
    private final ObjectMapper json;

    public JsonNode read(String projectId, String artifactPath) {
        Path video = VideoTimeline.projectVideo(project(projectId).rootPath(), artifactPath);
        return VideoTimeline.read(json, video, artifactPath).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "timeline_missing", "该视频尚未保存轨道清单"));
    }

    public JsonNode recover(String projectId, String artifactPath) {
        Project project = project(projectId);
        Path video = VideoTimeline.projectVideo(project.rootPath(), artifactPath);
        operations.acquire(projectId);
        try {
            var existing = VideoTimeline.read(json, video, artifactPath);
            if (existing.isPresent()) return existing.get();
            var version = scenes.findLatestVersionByArtifact(projectId, artifactPath)
                    .orElseThrow(() -> new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "timeline_source_missing",
                            "该视频没有可恢复的工程版本，可使用成片时间范围"));
            String videoHash = VideoTimeline.videoHash(video);
            JsonNode film = version.film();
            JsonNode manifest;
            int frames;
            double fps;
            String sourceHash = null;
            if (film != null && "project-render".equals(film.path("kind").asText())) {
                String snapshot = film.path("sourceSnapshot").asText("");
                sourceHash = film.path("sourceHash").asText("");
                if (snapshot.isBlank() || sourceHash.isBlank()) throw missingSource();
                Path source = snapshots.resolve(Path.of(project.rootPath()), snapshot);
                if (!sourceHash.equals(ProjectSourceFingerprint.compute(source))) throw missingSource();
                var config = configs.read(source);
                if (!config.entry().equals(film.path("entry").asText())
                        || !config.compositionId().equals(film.path("compositionId").asText())) throw missingSource();
                var result = renderer.inspectTimeline(source, config);
                frames = result.durationInFrames();
                fps = result.fps();
                if (frames != film.path("output").path("durationInFrames").asInt()
                        || Math.abs(fps - film.path("output").path("fps").asDouble()) > 0.000001
                        || !sourceHash.equals(ProjectSourceFingerprint.compute(source))) throw missingSource();
                manifest = result.sequences();
            } else {
                manifest = VideoTimeline.fromFilm(json, film);
                fps = manifest.path("fps").asDouble();
                frames = (int) Math.round(manifest.path("durationSeconds").asDouble() * fps);
            }
            probe.verify(video, frames, fps);
            if (!videoHash.equals(VideoTimeline.videoHash(video))) {
                throw new ApiException(HttpStatus.CONFLICT, "timeline_video_changed", "恢复期间视频文件发生变化，请重新打开预览");
            }
            return VideoTimeline.write(json, video, artifactPath, manifest, frames, fps, sourceHash, true);
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "timeline_read_failed", "无法读取视频文件");
        } finally {
            operations.release(projectId);
        }
    }

    private Project project(String projectId) {
        return projects.findById(projectId).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
    }

    private ApiException missingSource() {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "timeline_source_missing",
                "该视频的工程快照缺失或内容不一致，可使用成片时间范围");
    }
}
