package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.*;
import com.fengmotion.server.project.store.*;
import com.fengmotion.server.render.service.ProjectFilmRenderer;

class SourceFrameServiceTest {
    @TempDir Path root;
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final ProjectSceneRepository scenes = mock(ProjectSceneRepository.class);
    private final ProjectFilmRenderer renderer = mock(ProjectFilmRenderer.class);
    private final ProjectOperationLock operations = new ProjectOperationLock();
    private SourceFrameService service;
    private SourceFrameService.Request request;

    @BeforeEach void setup() throws Exception {
        Files.createDirectory(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "original");
        Files.writeString(root.resolve("film.config.json"), "{\"entry\":\"src/index.tsx\",\"compositionId\":\"Main\"}");
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project", "Film", null, null, root.toString(), Instant.now())));
        var trees = new ProjectWorktreeService(projects, scenes, operations);
        service = new SourceFrameService(projects, trees, new ProjectSourceSnapshots(), new ProjectFilmConfig(new ObjectMapper()), renderer, operations);
        request = new SourceFrameService.Request(0L, trees.read("project").sourceHash(), 15);
        when(renderer.renderStill(any(), any(), any(), anyInt())).thenAnswer(invocation -> {
            writePng(invocation.getArgument(2), 960, 540);
            return new ProjectFilmRenderer.Result(invocation.getArgument(2),60,960,540,30);
        });
    }

    @Test void capturesOnlyRequestedSnapshotWithoutCommittingAVersion() throws Exception {
        var frame = service.capture("project", request);
        assertEquals(15, frame.frame());
        assertEquals(request.sourceHash(), frame.sourceHash());
        assertTrue(frame.dataUrl().startsWith("data:image/png;base64,iVBOR"));
        assertEquals(960, frame.width());
        verify(scenes, never()).commitWithSnapshot(any(),anyLong(),any(),any(),any(),any(),any(),any(),any());
        try (var files = Files.list(root.resolve(".fengmotion/source-snapshots"))) { assertEquals(0, files.count()); }
        try (var deletion = operations.beginDeletion("project")) { assertNotNull(deletion); }
    }

    @Test void staleOrInvalidRequestsDoNotRender() throws Exception {
        assertThrows(ApiException.class, () -> service.capture("project", new SourceFrameService.Request(0L, request.sourceHash(), -1)));
        assertEquals("scene_version_conflict", assertThrows(ApiException.class,
                () -> service.capture("project", new SourceFrameService.Request(1L, request.sourceHash(), 0))).getCode());
        Files.writeString(root.resolve("src/index.tsx"), "new draft");
        assertEquals("source_changed", assertThrows(ApiException.class, () -> service.capture("project", request)).getCode());
        verifyNoInteractions(renderer);
    }

    @Test void failureCleansSnapshotAndReleasesCapacity() throws Exception {
        doThrow(new IllegalStateException("render failed")).when(renderer).renderStill(any(), any(), any(), anyInt());
        for (int attempt = 0; attempt < 3; attempt++) assertThrows(IllegalStateException.class, () -> service.capture("project", request));
        try (var files = Files.list(root.resolve(".fengmotion/source-snapshots"))) { assertEquals(0, files.count()); }
        try (var deletion = operations.beginDeletion("project")) { assertNotNull(deletion); }
    }

    @Test void frozenFrameSurvivesLaterWorkingEditsAndBoundsConcurrentWork() throws Exception {
        var entered = new CountDownLatch(2);
        var finish = new CountDownLatch(1);
        doAnswer(invocation -> {
            Path frozen = invocation.getArgument(0);
            entered.countDown();
            assertTrue(finish.await(3,TimeUnit.SECONDS));
            assertEquals("original",Files.readString(frozen.resolve("src/index.tsx")));
            writePng(invocation.getArgument(2), 960, 540);
            return new ProjectFilmRenderer.Result(invocation.getArgument(2),60,960,540,30);
        }).when(renderer).renderStill(any(), any(), any(), anyInt());
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> service.capture("project",request));
            var second = executor.submit(() -> service.capture("project",request));
            try {
                assertTrue(entered.await(3,TimeUnit.SECONDS));
                assertEquals("frame_queue_full",assertThrows(ApiException.class,()->service.capture("project",request)).getCode());
                assertThrows(ApiException.class,()->operations.beginDeletion("project"));
                Files.writeString(root.resolve("src/index.tsx"),"later draft");
            } finally { finish.countDown(); }
            assertEquals(request.sourceHash(),first.get().sourceHash());
            assertEquals(request.sourceHash(),second.get().sourceHash());
        }
    }

    private void writePng(Path file, int width, int height) throws Exception {
        javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(width, height, java.awt.image.BufferedImage.TYPE_INT_RGB), "png", file.toFile());
    }

    @Test void signatureOnlyAndMismatchedImagesCannotBePresentedAsSuccessfulFrames() throws Exception {
        doAnswer(invocation -> {
            Files.write(invocation.getArgument(2), new byte[]{(byte)137,80,78,71,13,10,26,10,0});
            return new ProjectFilmRenderer.Result(invocation.getArgument(2),60,960,540,30);
        }).when(renderer).renderStill(any(), any(), any(), anyInt());
        assertEquals("frame_invalid", assertThrows(ApiException.class, () -> service.capture("project", request)).getCode());
        doAnswer(invocation -> {
            writePng(invocation.getArgument(2), 10, 10);
            return new ProjectFilmRenderer.Result(invocation.getArgument(2),60,960,540,30);
        }).when(renderer).renderStill(any(), any(), any(), anyInt());
        assertEquals("frame_invalid", assertThrows(ApiException.class, () -> service.capture("project", request)).getCode());
        try (var files = Files.list(root.resolve(".fengmotion/source-snapshots"))) { assertEquals(0, files.count()); }
    }
}
