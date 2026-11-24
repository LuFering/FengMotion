package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.store.CreationStateStore;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

class SourceRestoreCoordinationTest {
    @TempDir Path root;
    private final ObjectMapper json = new ObjectMapper();
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final ProjectSceneRepository scenes = mock(ProjectSceneRepository.class);
    private final ProjectOperationLock operations = new ProjectOperationLock();
    private SceneVersionService service;
    private ObjectNode film;

    @BeforeEach void setup() throws Exception {
        Files.createDirectory(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "historical source");
        var snapshots = new ProjectSourceSnapshots();
        String hash = ProjectSourceFingerprint.compute(root);
        String snapshot = snapshots.capture(root);
        film = json.createObjectNode().put("kind", "project-render")
                .put("sourceSnapshot", snapshot).put("sourceHash", hash);
        Files.writeString(root.resolve("src/index.tsx"), "current draft");
        when(projects.findById("project")).thenReturn(Optional.of(
                new Project("project", "Film", null, null, root.toString(), Instant.now())));
        when(scenes.find("project")).thenReturn(Optional.of(
                new ProjectScene("project", 2L, film, null, Instant.now())));
        when(scenes.findVersion("project", 1L)).thenReturn(Optional.of(version(1L)));
        when(scenes.findVersion("project", 3L)).thenReturn(Optional.of(version(3L)));
        service = new SceneVersionService(projects, scenes, snapshots, operations, new CreationStateStore(json));
    }

    private ProjectSceneVersion version(long number) {
        return new ProjectSceneVersion("project", number, film, null, "", "", "renders/original.mp4",
                ProjectSceneVersion.SOURCE_TASK, null, Instant.now());
    }

    @Test void activePreviewWriteRejectsRestoreWithoutTouchingSourceOrHistory() throws Exception {
        try (var guard = SourceWriteGuard.acquire(root)) {
            ApiException failure = assertThrows(ApiException.class, () -> service.restore("project", 1L, 2L));
            assertEquals("source_busy", failure.getCode());
            assertEquals("current draft", Files.readString(root.resolve("src/index.tsx")));
            assertTrue(Files.exists(root.resolve(".fengmotion/source-write.lock/owner.json")));
            verify(scenes, never()).commitWithSnapshot(any(), anyLong(), any(), any(), any(), any(), any(), any(), any());
        }
        assertFalse(operations.isBusy("project"));
    }

    @Test void restoreHoldsSharedWriteLockUntilTheNewVersionIsCommitted() throws Exception {
        when(scenes.commitWithSnapshot(any(), anyLong(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(invocation -> {
                    assertEquals("historical source", Files.readString(root.resolve("src/index.tsx")));
                    assertEquals("source_busy", assertThrows(ApiException.class, () -> SourceWriteGuard.acquire(root)).getCode());
                    return Optional.of(3L);
                });
        assertEquals(3L, service.restore("project", 1L, 2L).version());
        assertEquals("historical source", Files.readString(root.resolve("src/index.tsx")));
        assertFalse(Files.exists(root.resolve(".fengmotion/source-write.lock")));
        assertFalse(operations.isBusy("project"));
    }

    @Test void commitConflictRollsBackTheDraftBeforeReleasingTheWriteLock() throws Exception {
        when(scenes.commitWithSnapshot(any(), anyLong(), any(), any(), any(), any(), any(), any(), any()))
                .thenAnswer(invocation -> {
                    assertEquals("source_busy", assertThrows(ApiException.class, () -> SourceWriteGuard.acquire(root)).getCode());
                    return Optional.empty();
                });
        assertEquals("scene_version_conflict", assertThrows(ApiException.class,
                () -> service.restore("project", 1L, 2L)).getCode());
        assertEquals("current draft", Files.readString(root.resolve("src/index.tsx")));
        assertFalse(Files.exists(root.resolve(".fengmotion/source-write.lock")));
        assertFalse(operations.isBusy("project"));
    }

    @Test void corruptCurrentRecordCanBeRecoveredFromVerifiedHistoryWithExplicitBaseline() throws Exception {
        when(scenes.find("project")).thenReturn(Optional.of(new ProjectScene("project", 2L, null, null, Instant.now())));
        assertEquals("scene_corrupt", assertThrows(ApiException.class, () -> service.restore("project", 1L, null)).getCode());
        assertEquals("current draft", Files.readString(root.resolve("src/index.tsx")));
        when(scenes.commitWithSnapshot(any(), anyLong(), any(), any(), any(), any(), any(), any(), any())).thenReturn(Optional.of(3L));
        assertEquals(3L, service.restore("project", 1L, 2L).version());
        assertEquals("historical source", Files.readString(root.resolve("src/index.tsx")));
        assertFalse(operations.isBusy("project"));
    }
}
