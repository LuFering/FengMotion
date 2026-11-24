package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.*;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.store.*;
import com.fengmotion.server.render.service.VideoTimeline;

class VersionReviewServiceTest {
    @TempDir Path root;
    private final ObjectMapper json = new ObjectMapper();
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final ProjectSceneRepository scenes = mock(ProjectSceneRepository.class);
    private LocalStateStore documents;
    private VersionReviewService service;
    private String hash;

    @BeforeEach void setup() throws Exception {
        Path video = Files.writeString(root.resolve("video.mp4"), "original-video");
        hash = VideoTimeline.videoHash(video);
        documents = new LocalStateStore(new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:" + root.resolve("review.db"))), json);
        var init = LocalStateStore.class.getDeclaredMethod("init"); init.setAccessible(true); init.invoke(documents);
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project", "review", null, null, root.toString(), Instant.now())));
        var film = json.createObjectNode().put("sourceHash", "source");
        when(scenes.findVersion("project", 1)).thenReturn(Optional.of(new ProjectSceneVersion("project", 1, film, null, "", "", "video.mp4", "task", null, Instant.now())));
        when(scenes.find("project")).thenReturn(Optional.of(new ProjectScene("project", 1, film, null, Instant.now())));
        service = new VersionReviewService(projects, scenes, new ProjectOperationLock(), documents, json);
    }

    private void verification(String conclusion, String videoHash, long version) {
        var result = json.createObjectNode().put("version", version).put("videoHash", videoHash)
                .put("scope", "technical-integrity-v1").put("conclusion", conclusion);
        var envelope = json.createObjectNode().put("state", "completed");
        envelope.putObject("request").put("kind", "version_verify");
        envelope.set("result", result);
        long revision = documents.find("workbench-job", "verify-one").map(LocalStateStore.Document::revision).orElse(0L);
        documents.put("workbench-job", "verify-one", "project", revision, envelope, false);
    }

    @Test void approvalRequiresMatchingVerificationAndHistoryIsAppendOnly() {
        var request = new VersionReviewService.Request("review-one", 0L, "approved", "已人工观看", hash, "verify-one");
        verification("failed", hash, 1);
        assertEquals("review_verification_required", assertThrows(ApiException.class, () -> service.record("project", 1, request)).getCode());
        assertEquals("unreviewed", service.read("project", 1).state());
        verification("passed", "0".repeat(64), 1);
        assertThrows(ApiException.class, () -> service.record("project", 1, request));
        verification("passed", hash, 2);
        assertThrows(ApiException.class, () -> service.record("project", 1, request));
        verification("passed", hash, 1);
        var first = service.record("project", 1, request);
        assertEquals(first, service.record("project", 1, request));
        assertEquals("approved", service.read("project", 1).state());
        assertEquals(1, service.read("project", 1).revision());
        assertEquals("review_conflict", assertThrows(ApiException.class, () -> service.record("project", 1,
                new VersionReviewService.Request("stale", 0L, "rejected", "遮挡", hash, null))).getCode());
        service.record("project", 1, new VersionReviewService.Request("reject", 1L, "rejected", "遮挡", hash, null));
        var current = service.read("project", 1);
        assertEquals("rejected", current.state());
        assertEquals(2, current.history().size());
        assertEquals(first, current.history().getFirst());
        assertTrue(documents.listNamespaces(java.util.Set.of("review", "workflow")).isEmpty());
    }

    @Test void changedVideoInvalidatesTheDecisionAndReplayCannotRewriteIt() throws Exception {
        var request = new VersionReviewService.Request("reject", 0L, "rejected", "需要修改", hash, null);
        var saved = service.record("project", 1, request);
        Files.writeString(root.resolve("video.mp4"), "changed-video");
        assertEquals("stale", service.read("project", 1).state());
        assertEquals(saved, service.record("project", 1, request));
        assertEquals("review_video_changed", assertThrows(ApiException.class, () -> service.record("project", 1,
                new VersionReviewService.Request("new", 1L, "rejected", "再次修改", hash, null))).getCode());
        assertEquals("review_idempotency_conflict", assertThrows(ApiException.class, () -> service.record("project", 1,
                new VersionReviewService.Request("reject", 0L, "rejected", "替换历史", hash, null))).getCode());
    }

    @Test void oldVersionAndAnotherProjectCannotReceiveANewReview() {
        when(scenes.find("project")).thenReturn(Optional.of(new ProjectScene("project", 2, json.createObjectNode(), null, Instant.now())));
        var request = new VersionReviewService.Request("old", 0L, "rejected", "old", hash, null);
        assertEquals("scene_version_conflict", assertThrows(ApiException.class, () -> service.record("project", 1, request)).getCode());
        assertEquals("not_found", assertThrows(ApiException.class, () -> service.read("other", 1)).getCode());
        assertEquals("validation_error", assertThrows(ApiException.class, () -> service.record("project", 1,
                new VersionReviewService.Request("empty", 0L, "rejected", " ", hash, null))).getCode());
    }

    @Test void malformedStoredReviewIsNotReportedAsAnApprovalOrOverwritten() {
        var data = json.createObjectNode();
        data.putArray("records").addObject().putObject("decision").put("decision", "approved");
        documents.put("version-review", "project:1", "project", 0, data, false);
        assertEquals("review_record_invalid", assertThrows(ApiException.class, () -> service.read("project", 1)).getCode());
        assertEquals("review_record_invalid", assertThrows(ApiException.class, () -> service.record("project", 1,
                new VersionReviewService.Request("reject", 1L, "rejected", "reason", hash, null))).getCode());
        assertEquals(1, documents.find("version-review", "project:1").orElseThrow().revision());
    }
}
