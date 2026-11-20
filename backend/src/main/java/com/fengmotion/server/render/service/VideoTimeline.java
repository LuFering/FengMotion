package com.fengmotion.server.render.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import org.springframework.http.HttpStatus;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;

public final class VideoTimeline {
    private static final Set<String> KINDS = Set.of("shape", "text", "video", "audio", "image");
    private static final Set<String> DETAILS = Set.of("sequences", "composition", "limited", "unavailable");
    private static final long MAX_FILE_BYTES = 1_048_576;

    private VideoTimeline() {}

    public static Path projectVideo(String rootPath, String artifactPath) {
        if (rootPath == null || rootPath.isBlank() || artifactPath == null || artifactPath.isBlank()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "找不到该版本的视频");
        }
        try {
            Path root = Path.of(rootPath).toRealPath();
            Path relative = Path.of(artifactPath);
            Path video = root.resolve(relative).normalize();
            if (relative.isAbsolute() || !video.startsWith(root) || !video.getFileName().toString()
                    .toLowerCase(Locale.ROOT).matches(".+\\.(mp4|mov|webm|m4v)")) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "无效的视频产物路径");
            }
            if (!Files.isRegularFile(video, LinkOption.NOFOLLOW_LINKS)) {
                throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "找不到该版本的视频");
            }
            Path real = video.toRealPath();
            if (!real.startsWith(root)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "无效的视频产物路径");
            }
            return real;
        } catch (InvalidPathException invalid) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "无效的视频产物路径");
        } catch (IOException missing) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "找不到该版本的视频");
        }
    }

    public static Optional<JsonNode> read(ObjectMapper json, Path video, String artifactPath) {
        Path file = manifestPath(video);
        if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) return Optional.empty();
        try {
            if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > MAX_FILE_BYTES) {
                throw invalid();
            }
            JsonNode stored = json.readTree(file.toFile());
            if (stored == null || !stored.isObject()) throw invalid();
            JsonNode manifest = stored.path("manifest");
            if (artifactPath == null || !artifactPath.equals(manifest.path("artifactPath").asText())) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "timeline_artifact_mismatch", "轨道清单属于其他视频产物");
            }
            validate(manifest, artifactPath, manifest.path("fps").asDouble(), manifest.path("durationSeconds").asDouble());
            if (!stored.path("videoSha256").asText().equals(videoHash(video))) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "timeline_video_changed", "视频文件已变化，无法沿用原来的轨道");
            }
            return Optional.of(manifest);
        } catch (com.fasterxml.jackson.core.JsonProcessingException malformed) {
            throw invalid();
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "timeline_read_failed", "读取视频轨道失败");
        }
    }

    public static JsonNode write(ObjectMapper json, Path video, String artifactPath, JsonNode raw,
                                 int frames, double fps, String sourceHash, boolean recovered) {
        JsonNode base = raw != null && raw.isObject()
                ? raw : composition(json, frames, fps, video.getFileName().toString(), "unavailable");
        ObjectNode manifest = base.deepCopy();
        manifest.remove("sourceHash");
        manifest.put("artifactPath", artifactPath);
        if (sourceHash != null) manifest.put("sourceHash", sourceHash);
        manifest.put("recovered", recovered);
        validate(manifest, artifactPath, fps, frames / fps);
        Path temporary = null;
        try {
            ObjectNode stored = json.createObjectNode().put("videoSha256", videoHash(video));
            stored.set("manifest", manifest);
            byte[] bytes = json.writeValueAsBytes(stored);
            if (bytes.length > MAX_FILE_BYTES) throw invalid();
            temporary = Files.createTempFile(video.getParent(), ".timeline-", ".tmp");
            Files.write(temporary, bytes);
            Files.move(temporary, manifestPath(video), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            return manifest;
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "timeline_write_failed", "保存视频轨道失败");
        } finally {
            if (temporary != null) {
                try { Files.deleteIfExists(temporary); } catch (IOException ignored) { }
            }
        }
    }

    public static void discard(Path video) throws IOException {
        Files.deleteIfExists(video);
        Files.deleteIfExists(manifestPath(video));
    }

    public static JsonNode composition(ObjectMapper json, int frames, double fps, String name, String detail) {
        if (frames < 1 || !Double.isFinite(fps) || fps < 1 || fps > 240 || !DETAILS.contains(detail)) {
            throw invalid();
        }
        ObjectNode manifest = json.createObjectNode()
                .put("schemaVersion", 2)
                .put("fps", fps)
                .put("durationSeconds", frames / fps)
                .put("origin", "render-runtime")
                .put("detail", detail);
        ObjectNode track = manifest.putArray("tracks").addObject()
                .put("id", "composition")
                .put("name", "成片");
        track.putArray("clips").addObject()
                .put("id", "composition")
                .put("name", name == null || name.isBlank() ? "成片" : truncate(name, 80))
                .put("kind", "video")
                .put("start", 0)
                .put("duration", frames / fps);
        return manifest;
    }

    public static JsonNode fromFilm(ObjectMapper json, JsonNode film) {
        double fps = film == null ? 0 : film.path("fps").asDouble(0);
        JsonNode scenes = film == null ? null : film.path("scenes");
        if (!Double.isFinite(fps) || fps < 1 || fps > 240 || scenes == null || !scenes.isArray() || scenes.isEmpty()) {
            throw invalid();
        }
        double secondsTotal = 0;
        for (JsonNode scene : scenes) {
            double seconds = scene.path("durationSeconds").asDouble(0);
            if (!Double.isFinite(seconds) || seconds <= 0 || seconds > 36000) throw invalid();
            secondsTotal += seconds;
        }
        if (secondsTotal > 36000) throw invalid();
        int totalFrames = Math.max(1, (int) Math.round(secondsTotal * fps));
        if (scenes.size() > 400) return composition(json, totalFrames, fps, "成片", "limited");
        Map<String, ArrayNode> clipsByTrack = new LinkedHashMap<>();
        Map<String, String> trackNames = Map.of(
                "visual", "场景画面", "text", "文字", "subtitle", "字幕");
        int cursor = 0;
        int index = 0;
        for (JsonNode scene : scenes) {
            if (cursor >= totalFrames) break;
            double seconds = scene.path("durationSeconds").asDouble(0);
            int duration = Math.min(totalFrames - cursor, Math.max(1, (int) Math.round(seconds * fps)));
            String sceneName = firstText(scene, "name", "title", "id");
            if (sceneName.isBlank()) sceneName = "场景 " + (index + 1);
            String visualKind = scene.path("backgroundImage").isTextual() && !scene.path("backgroundImage").asText().isBlank()
                    ? "image" : "shape";
            addClip(json, clipsByTrack, "visual", "visual", sceneName, visualKind, cursor, duration, fps, index);
            addOptionalClip(json, clipsByTrack, scene, "text", "text", "主文字", cursor, duration, fps, index);
            addOptionalClip(json, clipsByTrack, scene, "subtitle", "subtitle", "副标题", cursor, duration, fps, index);
            cursor += duration;
            index++;
        }

        ObjectNode manifest = json.createObjectNode()
                .put("schemaVersion", 2)
                .put("fps", fps)
                .put("durationSeconds", totalFrames / fps)
                .put("origin", "scene-data")
                .put("detail", "sequences");
        ArrayNode tracks = manifest.putArray("tracks");
        for (var entry : clipsByTrack.entrySet()) {
            ObjectNode track = tracks.addObject()
                    .put("id", "track-" + entry.getKey())
                    .put("name", trackNames.get(entry.getKey()));
            track.set("clips", entry.getValue());
        }
        if (clipsByTrack.values().stream().mapToInt(ArrayNode::size).sum() > 400) {
            return composition(json, totalFrames, fps, "成片", "limited");
        }
        validate(manifest, "timeline-recovery.mp4", fps, totalFrames / fps);
        return manifest;
    }

    private static void addOptionalClip(ObjectMapper json, Map<String, ArrayNode> clipsByTrack,
                                        JsonNode scene, String field, String group, String fallbackName,
                                        int start, int duration, double fps, int index) {
        JsonNode value = scene.path(field);
        if (!value.isTextual() || value.asText().isBlank()) return;
        addClip(json, clipsByTrack, group, group, value.asText().length() > 80 ? fallbackName : value.asText(),
                "text",
                start, duration, fps, index);
    }

    private static void addClip(ObjectMapper json, Map<String, ArrayNode> clipsByTrack,
                                String key, String group, String name, String kind,
                                int start, int duration, double fps, int index) {
        ArrayNode clips = clipsByTrack.computeIfAbsent(key, ignored -> json.createArrayNode());
        String identity = group + ":" + index + ":" + start;
        clips.addObject()
                .put("id", sha256(identity).substring(0, 20))
                .put("name", truncate(name, 80))
                .put("kind", kind)
                .put("start", start / fps)
                .put("duration", duration / fps);
    }

    private static String firstText(JsonNode node, String... fields) {
        for (String field : fields) {
            JsonNode value = node.path(field);
            if (value.isTextual() && !value.asText().isBlank()) return value.asText();
        }
        return "";
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static String truncate(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max);
    }

    public static Path manifestPath(Path video) {
        return video.resolveSibling("." + video.getFileName() + ".sequences.json");
    }

    public static String videoHash(Path video) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (var stream = new DigestInputStream(Files.newInputStream(video), digest)) {
                stream.transferTo(java.io.OutputStream.nullOutputStream());
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static void validate(JsonNode manifest, String artifactPath, double fps, double duration) {
        if (manifest == null || manifest.path("schemaVersion").asInt() != 2
                || !DETAILS.contains(manifest.path("detail").asText())
                || artifactPath == null || artifactPath.isBlank() || artifactPath.length() > 2048
                || !number(manifest.path("fps"), 1, 240)
                || !number(manifest.path("durationSeconds"), 1.0 / 240, 36000)
                || !Double.isFinite(fps) || Math.abs(manifest.path("fps").asDouble() - fps) > 0.000001
                || !Double.isFinite(duration) || Math.abs(manifest.path("durationSeconds").asDouble() - duration) > 0.000001) {
            throw invalid();
        }
        JsonNode tracks = manifest.path("tracks");
        if (!tracks.isArray() || tracks.isEmpty() || tracks.size() > 60) throw invalid();
        Set<String> trackIds = new HashSet<>();
        int count = 0;
        for (JsonNode track : tracks) {
            JsonNode clips = track.path("clips");
            if (!text(track.path("id"), 128) || !trackIds.add(track.path("id").asText())
                    || !text(track.path("name"), 60) || !clips.isArray() || clips.isEmpty()
                    || (count += clips.size()) > 400) throw invalid();
            Set<String> clipIds = new HashSet<>();
            double end = 0;
            for (JsonNode clip : clips) {
                JsonNode start = clip.path("start");
                JsonNode length = clip.path("duration");
                if (!text(clip.path("id"), 128) || !clipIds.add(clip.path("id").asText())
                        || !text(clip.path("name"), 80) || !KINDS.contains(clip.path("kind").asText())
                        || !number(start, 0, duration) || !number(length, 0.001, duration)
                        || start.asDouble() < end - 0.000001
                        || start.asDouble() + length.asDouble() > duration + 0.000001) throw invalid();
                end = start.asDouble() + length.asDouble();
            }
        }
    }

    private static boolean number(JsonNode value, double min, double max) {
        return value.isNumber() && value.asDouble() >= min && value.asDouble() <= max;
    }

    private static boolean text(JsonNode value, int max) {
        return value.isTextual() && !value.textValue().isBlank() && value.textValue().length() <= max;
    }

    private static ApiException invalid() {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "timeline_invalid", "视频轨道清单无效");
    }
}
