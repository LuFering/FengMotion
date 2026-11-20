package com.fengmotion.server.render.service;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;

class VideoTimelineTest {
    @TempDir Path root;
    private final ObjectMapper json = new ObjectMapper();

    @Test void bindsEachManifestToItsVideoAndDetectsChangedBytes() throws Exception {
        Path first = Files.writeString(root.resolve("first.mp4"), "original");
        Path second = Files.writeString(root.resolve("second.mp4"), "other");
        var manifest = VideoTimeline.composition(json, 30, 29.97, "test", "composition");
        VideoTimeline.write(json, first, "first.mp4", manifest, 30, 29.97, "source-a", false);
        assertEquals("source-a", VideoTimeline.read(json, first, "first.mp4").orElseThrow().path("sourceHash").asText());
        assertTrue(VideoTimeline.read(json, second, "second.mp4").isEmpty());
        assertEquals("timeline_artifact_mismatch", assertThrows(ApiException.class,
                () -> VideoTimeline.read(json, first, "second.mp4")).getCode());
        Files.writeString(first, "replaced");
        assertEquals("timeline_video_changed", assertThrows(ApiException.class,
                () -> VideoTimeline.read(json, first, "first.mp4")).getCode());
        VideoTimeline.discard(first);
        assertFalse(Files.exists(VideoTimeline.manifestPath(first)));
        assertTrue(Files.exists(second));
    }

    @Test void rejectsTraversalAndSymlinkEscapes() throws Exception {
        assertThrows(ApiException.class, () -> VideoTimeline.projectVideo(root.toString(), "../escape.mp4"));
        Path outside = Files.createTempFile("outside-video-", ".mp4");
        try {
            Files.createSymbolicLink(root.resolve("link.mp4"), outside);
            assertThrows(ApiException.class, () -> VideoTimeline.projectVideo(root.toString(), "link.mp4"));
        } finally { Files.deleteIfExists(outside); }
    }

    @Test void rejectsOverlappingTracksAndKeepsPreviouslySavedManifest() throws Exception {
        Path video = Files.writeString(root.resolve("video.mp4"), "original");
        ObjectNode valid = (ObjectNode) VideoTimeline.composition(json, 30, 30, "test", "composition");
        VideoTimeline.write(json, video, "video.mp4", valid, 30, 30, null, false);
        byte[] before = Files.readAllBytes(VideoTimeline.manifestPath(video));
        var clips = (com.fasterxml.jackson.databind.node.ArrayNode) valid.path("tracks").path(0).path("clips");
        clips.add(clips.get(0).deepCopy());
        assertThrows(ApiException.class, () -> VideoTimeline.write(json, video, "video.mp4", valid, 30, 30, null, false));
        assertArrayEquals(before, Files.readAllBytes(VideoTimeline.manifestPath(video)));
    }

    @Test void sceneRecoveryMatchesRoundedFramesAndOnlySupportedMedia() throws Exception {
        var manifest = VideoTimeline.fromFilm(json, json.readTree("""
                {"fps":30,"scenes":[{"id":"first","durationSeconds":0.05,"text":"Hello","audio":"unsupported.mp3"},
                  {"id":"second","durationSeconds":0.05,"backgroundImage":"image.png"}]}
                """));
        assertEquals(0.1, manifest.path("durationSeconds").asDouble(), 0.000001);
        assertEquals(2, manifest.path("tracks").size());
        var scenes = manifest.path("tracks").path(0).path("clips");
        assertEquals(2.0 / 30, scenes.path(1).path("start").asDouble(), 0.000001);
        assertEquals(1.0 / 30, scenes.path(1).path("duration").asDouble(), 0.000001);
        assertEquals("image", scenes.path(1).path("kind").asText());
        assertThrows(ApiException.class, () -> VideoTimeline.fromFilm(json, null));
    }
}
