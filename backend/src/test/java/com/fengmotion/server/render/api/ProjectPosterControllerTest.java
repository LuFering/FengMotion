package com.fengmotion.server.render.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.asset.service.ThumbnailService;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.api.ProjectPosterController;

class ProjectPosterControllerTest {
    @TempDir Path root;
    private final ThumbnailService thumbnails = mock(ThumbnailService.class);
    private final ProjectOperationLock operations = new ProjectOperationLock();

    private ProjectPosterController controller() throws Exception {
        Files.createDirectories(root.resolve("renders"));
        Files.writeString(root.resolve("renders/film.mp4"), "first");
        var projects = mock(ProjectRepository.class);
        var scenes = mock(ProjectSceneRepository.class);
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project", "test", null, null, root.toString(), Instant.now())));
        when(scenes.findVersion("project", 1)).thenReturn(Optional.of(new ProjectSceneVersion("project", 1,
                new ObjectMapper().createObjectNode(), null, "", "", "renders/film.mp4", "task", null, Instant.now())));
        return new ProjectPosterController(projects, scenes, thumbnails, operations);
    }

    @Test void posterIsBoundToVideoContentsAndRegeneratesAfterReplacement() throws Exception {
        var controller = controller();
        when(thumbnails.extractVideoThumbnail(any(), any())).thenAnswer(call -> {
            assertEquals("project_busy", assertThrows(ApiException.class, () -> operations.beginDeletion("project")).getCode());
            Files.writeString(call.getArgument(1), "poster-" + Files.readString(call.getArgument(0)));
            return true;
        });
        var first = controller.get("project", 1);
        assertEquals("no-cache", first.getHeaders().getCacheControl());
        assertEquals(first.getHeaders().getETag(), controller.get("project", 1).getHeaders().getETag());
        verify(thumbnails, times(1)).extractVideoThumbnail(any(), any());
        Files.writeString(root.resolve("renders/film.mp4"), "second");
        var second = controller.get("project", 1);
        assertNotEquals(first.getHeaders().getETag(), second.getHeaders().getETag());
        assertEquals("poster-second", Files.readString(second.getBody().getFile().toPath()));
        verify(thumbnails, times(2)).extractVideoThumbnail(any(), any());
        try (var deletion = operations.beginDeletion("project")) {
            assertEquals("project_deleting", assertThrows(ApiException.class, () -> controller.get("project", 1)).getCode());
        }
    }

    @Test void linkedPosterCacheDoesNotWriteOutsideTheProject() throws Exception {
        var controller = controller();
        Path outside = Files.createTempDirectory("poster-outside-");
        try {
            Files.createDirectories(root.resolve(".fengmotion"));
            Files.createSymbolicLink(root.resolve(".fengmotion/posters"), outside);
            assertEquals("poster_path_invalid", assertThrows(ApiException.class, () -> controller.get("project", 1)).getCode());
            verifyNoInteractions(thumbnails);
            try (var entries = Files.list(outside)) { assertEquals(0, entries.count()); }
        } finally { Files.delete(outside); }
    }

    @Test void failedAndConcurrentExtractionDoesNotPublishPartialPoster() throws Exception {
        var controller = controller();
        when(thumbnails.extractVideoThumbnail(any(), any())).thenAnswer(call -> {
            Files.writeString(call.getArgument(1), "partial");
            return false;
        });
        assertThrows(ApiException.class, () -> controller.get("project", 1));
        doAnswer(call -> {
            Files.writeString(call.getArgument(1), "wrong-version");
            Files.writeString(call.getArgument(0), "replaced");
            return true;
        }).when(thumbnails).extractVideoThumbnail(any(), any());
        assertEquals("poster_video_changed", assertThrows(ApiException.class, () -> controller.get("project", 1)).getCode());
        try (var entries = Files.list(root.resolve(".fengmotion/posters"))) { assertEquals(0, entries.count()); }
    }
}
