package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.*;
import com.fengmotion.server.project.service.*;
import com.fengmotion.server.project.store.*;
import com.fengmotion.server.render.service.*;

class ProjectTimelineServiceTest {
    @TempDir Path root;
    private final ObjectMapper json = new ObjectMapper();
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final ProjectSceneRepository scenes = mock(ProjectSceneRepository.class);
    private final ProjectOperationLock operations = new ProjectOperationLock();
    private final ProjectFilmRenderer renderer = mock(ProjectFilmRenderer.class);
    private final VideoTimelineProbe probe = mock(VideoTimelineProbe.class);
    private final ProjectSourceSnapshots snapshots = new ProjectSourceSnapshots();

    private ProjectTimelineService service(JsonNode film) throws Exception {
        Files.writeString(root.resolve("video.mp4"), "preserved-video");
        when(projects.findById("project")).thenReturn(Optional.of(
                new Project("project", "name", null, null, root.toString(), Instant.now())));
        when(scenes.findLatestVersionByArtifact("project", "video.mp4")).thenReturn(Optional.of(new ProjectSceneVersion("project", 1, film,
                null, "", "", "video.mp4", "task", null, Instant.now())));
        return new ProjectTimelineService(projects, scenes, operations, snapshots, new ProjectFilmConfig(json), renderer, probe, json);
    }

    @Test void recoversScenesOnceWithoutWritingVersionsOrRerenderingVideo() throws Exception {
        var service = service(json.readTree("{\"fps\":30,\"scenes\":[{\"id\":\"one\",\"durationSeconds\":2}]}"));
        var first = service.recover("project", "video.mp4");
        assertEquals(first, service.recover("project", "video.mp4"));
        assertTrue(first.path("recovered").asBoolean());
        assertEquals("preserved-video", Files.readString(root.resolve("video.mp4")));
        verify(probe, times(1)).verify(any(), eq(60), eq(30.0));
        verify(scenes, times(1)).findLatestVersionByArtifact("project", "video.mp4");
        verify(scenes, never()).listVersions(any());
        verifyNoInteractions(renderer);
        verify(scenes, never()).commitWithSnapshot(any(), anyLong(), any(), any(), any(), any(), any(), any(), any());
        assertFalse(operations.isBusy("project"));
    }

    @Test void sourceRecoveryUsesExactSnapshotAndRejectsTampering() throws Exception {
        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "original");
        Files.writeString(root.resolve("film.config.json"), "{\"entry\":\"src/index.tsx\",\"compositionId\":\"Main\"}");
        String snapshot = snapshots.capture(root);
        String hash = ProjectSourceFingerprint.compute(root);
        var film = json.createObjectNode().put("kind", "project-render").put("entry", "src/index.tsx")
                .put("compositionId", "Main").put("sourceSnapshot", snapshot).put("sourceHash", hash);
        film.putObject("output").put("durationInFrames", 60).put("fps", 30);
        var service = service(film);
        Files.writeString(root.resolve("src/index.tsx"), "different-current-source");
        when(renderer.inspectTimeline(any(), any())).thenReturn(new ProjectFilmRenderer.Result(null, 60, 640, 360, 30,
                VideoTimeline.composition(json, 60, 30, "Main", "composition")));
        assertEquals(hash, service.recover("project", "video.mp4").path("sourceHash").asText());
        verify(renderer).inspectTimeline(eq(root.resolve(snapshot)), any());
        Files.delete(VideoTimeline.manifestPath(root.resolve("video.mp4")));
        Files.writeString(root.resolve(snapshot).resolve("src/index.tsx"), "tampered");
        assertThrows(ApiException.class, () -> service.recover("project", "video.mp4"));
        assertFalse(Files.exists(VideoTimeline.manifestPath(root.resolve("video.mp4"))));
        assertFalse(operations.isBusy("project"));
    }

    @Test void mismatchedVideoOrBusyProjectNeverGetsASidecar() throws Exception {
        var service = service(json.readTree("{\"fps\":30,\"scenes\":[{\"id\":\"one\",\"durationSeconds\":2}]}"));
        operations.acquire("project");
        assertEquals("project_busy", assertThrows(ApiException.class, () -> service.recover("project", "video.mp4")).getCode());
        assertTrue(operations.isBusy("project"));
        operations.release("project");
        doThrow(new ApiException(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY, "timeline_video_mismatch", "mismatch"))
                .when(probe).verify(any(), anyInt(), anyDouble());
        assertThrows(ApiException.class, () -> service.recover("project", "video.mp4"));
        assertFalse(Files.exists(VideoTimeline.manifestPath(root.resolve("video.mp4"))));
        assertFalse(operations.isBusy("project"));
    }
}
