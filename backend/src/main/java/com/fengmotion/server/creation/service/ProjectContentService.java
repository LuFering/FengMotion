package com.fengmotion.server.creation.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class ProjectContentService {
    private final ProjectRepository projects;
    private final ProjectSceneRepository versions;
    private final ProjectOperationLock operations;
    private final ProjectTimelineService timelines;

    public Content read(String projectId) {
        try (var activity = operations.participate(projectId)) {
            projects.findById(projectId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
            var current = versions.find(projectId).orElse(null);
            if (current == null) return new Content(new Timeline(projectId, 30, 1920, 1080, 0, List.of(), "assembly", "scene-0"), List.of());
            if (!current.present()) throw unavailable("当前版本记录损坏，不能当作未创建的空项目");
            var saved = versions.findVersion(projectId, current.version()).orElseThrow(() -> unavailable("当前版本缺少历史凭据"));
            if (saved.artifactPath() == null || saved.artifactPath().isBlank()) throw unavailable("当前版本没有成片产物，无法读取已验证时间线");
            JsonNode manifest = timelines.read(projectId, saved.artifactPath());
            JsonNode film = saved.film();
            if (film == null || !film.isObject() || !film.equals(current.film())) throw unavailable("当前场景与版本凭据不一致");
            String expectedHash = film.path("sourceHash").asText("");
            if (!expectedHash.isBlank() && !expectedHash.equals(manifest.path("sourceHash").asText())) throw unavailable("时间线源码指纹与当前版本不一致");
            double fps = manifest.path("fps").asDouble();
            long duration = milliseconds(manifest.path("durationSeconds").asDouble());
            boolean rendered = "project-render".equals(film.path("kind").asText());
            JsonNode specification = rendered ? film.path("output") : film;
            if (rendered && (Math.abs(specification.path("fps").asDouble() - fps) > 0.000001
                    || Math.abs(milliseconds(specification.path("durationInFrames").asDouble() / fps) - duration) > 1)) {
                throw unavailable("时间线规格与当前版本不一致");
            }
            var sceneRows = new ArrayList<Scene>();
            var clips = new ArrayList<Clip>();
            var knownShots = new java.util.HashMap<String, JsonNode>();
            for (JsonNode shot : film.path("shotTimeline").path("shots")) knownShots.put(shot.path("id").asText(), shot);
            Map<String, String> legacyIds = new java.util.HashMap<>();
            int legacyIndex = 0;
            for (JsonNode scene : film.path("scenes")) {
                String id = scene.path("id").asText("");
                if (!id.isBlank()) legacyIds.put(Integer.toString(legacyIndex), id);
                legacyIndex++;
            }
            int trackIndex = 0;
            var sceneIds = new java.util.HashSet<String>();
            for (JsonNode track : manifest.path("tracks")) {
                int clipIndex = 0;
                for (JsonNode clip : track.path("clips")) {
                    String identity = identity(track.path("id").asText(), clip.path("id").asText());
                    String sceneId = null;
                    boolean visual = List.of("shape", "video", "image").contains(clip.path("kind").asText());
                    if (visual) {
                        sceneId = identity;
                        if ("shot-assembly".equals(manifest.path("origin").asText()) && knownShots.containsKey(clip.path("id").asText())) {
                            sceneId = clip.path("id").asText();
                        } else if ("scene-data".equals(manifest.path("origin").asText()) && track.path("id").asText().equals("track-visual")) {
                            sceneId = legacyIds.getOrDefault(Integer.toString(clipIndex), identity);
                        }
                        if (!sceneIds.add(sceneId)) throw unavailable("当前版本包含重复场景ID，不能生成有歧义的场景详情");
                        sceneRows.add(new Scene(sceneId, projectId, sceneRows.size() + 1, clip.path("name").asText(),
                                clip.path("name").asText(), milliseconds(clip.path("start").asDouble() + clip.path("duration").asDouble())
                                - milliseconds(clip.path("start").asDouble()),
                                milliseconds(clip.path("start").asDouble()), null, "idle",
                                "来自当前成片轨道；已渲染不代表已通过内容审查。", null, null, true, true));
                    }
                    long start = milliseconds(clip.path("start").asDouble());
                    long end = milliseconds(clip.path("start").asDouble() + clip.path("duration").asDouble());
                    clips.add(new Clip(identity, sceneId, start, end - start, trackIndex, clip.path("name").asText()));
                    clipIndex++;
                }
                trackIndex++;
            }
            clips.sort(Comparator.comparingLong(Clip::startMs).thenComparingInt(Clip::track));
            sceneRows.sort(Comparator.comparingLong(Scene::startMs).thenComparing(Scene::id));
            var ordered = new ArrayList<Scene>();
            for (Scene scene : sceneRows) ordered.add(new Scene(scene.id(), projectId, ordered.size() + 1, scene.label(), scene.title(),
                    scene.durationMs(), scene.startMs(), null, scene.status(), scene.note(), null, null, true, true));
            long latest = versions.find(projectId).map(ProjectScene::version).orElse(0L);
            if (latest != current.version()) throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict", "读取内容期间版本已变化，请重试");
            return new Content(new Timeline(projectId, fps, dimension(specification, "width", 1920), dimension(specification, "height", 1080),
                    duration, List.copyOf(clips), "assembly", "scene-" + current.version() + "-" + identity("film", film.toString())), List.copyOf(ordered));
        }
    }

    public Scene scene(String projectId, String sceneId) {
        return read(projectId).scenes().stream().filter(scene -> scene.id().equals(sceneId)).findFirst().orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "not_found", "当前版本不存在该场景"));
    }

    private static int dimension(JsonNode specification, String field, int fallback) {
        int value = specification.path(field).asInt();
        return value > 0 ? value : fallback;
    }

    private static long milliseconds(double seconds) { return Math.round(seconds * 1000); }

    private static String identity(String track, String clip) {
        try {
            return "clip-" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest((track + "\u0000" + clip).getBytes(StandardCharsets.UTF_8))).substring(0, 24);
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private static ApiException unavailable(String message) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "project_content_unavailable", message);
    }

    public record Clip(String id, String sceneId, long startMs, long durationMs, int track, String title) { }
    public record Timeline(String projectId, double fps, int width, int height, long durationMs, List<Clip> clips, String source, String etag) { }
    public record Scene(String id, String projectId, int index, String label, String title, long durationMs, long startMs,
                        String thumbnailUrl, String status, String note, String compositionUrl, String storyboardId, boolean inTimeline, boolean timingKnown) { }
    public record Content(Timeline timeline, List<Scene> scenes) { }
}
