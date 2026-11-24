package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.*;
import com.fengmotion.server.project.service.*;
import com.fengmotion.server.project.store.*;
import com.fengmotion.server.render.service.*;

class VersionVerificationServiceTest {
    @TempDir Path root;
    private final ObjectMapper json = new ObjectMapper();
    private final ProjectSceneRepository scenes = mock(ProjectSceneRepository.class);
    private final VideoTimelineProbe probe = mock(VideoTimelineProbe.class);
    private final ProjectOperationLock operations = new ProjectOperationLock();

    private VersionVerificationService service() throws Exception {
        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "source");
        Files.writeString(root.resolve("film.config.json"), "{\"entry\":\"src/index.tsx\",\"compositionId\":\"Main\"}");
        var snapshots = new ProjectSourceSnapshots();
        String hash = ProjectSourceFingerprint.compute(root);
        String snapshot = snapshots.capture(root);
        ObjectNode film = json.createObjectNode().put("kind", "project-render").put("entry", "src/index.tsx")
                .put("compositionId", "Main").put("sourceHash", hash).put("sourceSnapshot", snapshot);
        film.putObject("output").put("width", 640).put("height", 360).put("fps", 30).put("durationInFrames", 60);
        Path video = Files.writeString(root.resolve("video.mp4"), "video");
        VideoTimeline.write(json, video, "video.mp4", VideoTimeline.composition(json, 60, 30, "Main", "composition"), 60, 30, hash, false);
        when(scenes.findVersion("project", 1)).thenReturn(Optional.of(new ProjectSceneVersion("project", 1, film, null, "", "", "video.mp4", "task", null, Instant.now())));
        var projects = mock(ProjectRepository.class);
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project", "test", null, null, root.toString(), Instant.now())));
        return new VersionVerificationService(projects, scenes, operations, snapshots, new ProjectFilmConfig(json), probe, json);
    }

    @Test void technicalPassIsNotVisualApprovalAndDoesNotWriteVersions() throws Exception {
        var service = service();
        doAnswer(call -> {
            assertEquals("project_busy", assertThrows(ApiException.class, () -> operations.beginDeletion("project")).getCode());
            return null;
        }).when(probe).verify(any(), eq(60), eq(30.0), eq(640), eq(360));
        var report = service.verify("project", 1);
        assertEquals("passed", report.conclusion());
        assertEquals("not_run", report.visualReview());
        assertEquals("technical-integrity-v1", report.scope());
        assertEquals(4, report.checks().size());
        assertEquals(64, report.videoHash().length());
        verify(scenes, never()).commitWithSnapshot(any(), anyLong(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test void absentProbeAndMissingTimelineCannotBeMarkedPassed() throws Exception {
        var service = service();
        doThrow(new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "timeline_probe_failed", "ffprobe unavailable"))
                .when(probe).verify(any(), anyInt(), anyDouble(), any(), any());
        assertEquals("not_run", service.verify("project", 1).conclusion());
        Files.delete(VideoTimeline.manifestPath(root.resolve("video.mp4")));
        var report = service.verify("project", 1);
        assertEquals("failed", report.conclusion());
        assertTrue(report.checks().stream().anyMatch(check -> check.code().equals("timeline_missing")));
        assertFalse(Files.exists(VideoTimeline.manifestPath(root.resolve("video.mp4"))));
    }

    @Test void missingVideoAndCorruptSnapshotAreReportedWithoutRendering() throws Exception {
        var service = service();
        Files.delete(root.resolve("video.mp4"));
        var film = scenes.findVersion("project", 1).orElseThrow().film();
        Files.writeString(root.resolve(film.path("sourceSnapshot").asText()).resolve("src/index.tsx"), "tampered");
        var report = service.verify("project", 1);
        assertEquals("failed", report.conclusion());
        assertTrue(report.checks().stream().anyMatch(check -> check.code().equals("snapshot_corrupt")));
        verifyNoInteractions(probe);
    }

    @Test void changedVideoInvalidatesTheReportAndWrongProjectIsRejected() throws Exception {
        var service = service();
        doAnswer(call -> { Files.writeString(root.resolve("video.mp4"), "changed"); return null; })
                .when(probe).verify(any(), anyInt(), anyDouble(), any(), any());
        assertEquals("verification_changed", assertThrows(ApiException.class, () -> service.verify("project", 1)).getCode());
        assertEquals("not_found", assertThrows(ApiException.class, () -> service.verify("other", 1)).getCode());
    }
}
