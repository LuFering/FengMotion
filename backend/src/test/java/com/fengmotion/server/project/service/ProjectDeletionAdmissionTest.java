package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.store.ProjectPurgeRepository;

class ProjectDeletionAdmissionTest {
    @TempDir Path workspace;
    private final ProjectOperationLock operations = new ProjectOperationLock();
    private final ProjectPurgeRepository repository = mock(ProjectPurgeRepository.class);

    private ProjectPurgeService service() throws Exception {
        Path root = Files.createDirectories(workspace.resolve("project"));
        Files.writeString(root.resolve("source.txt"), "keep");
        when(repository.findRootPath("project")).thenReturn(Optional.of(root.toString()));
        when(repository.deleteProjectGraph("project")).thenReturn(1);
        var service = new ProjectPurgeService(repository, new ProjectDirectoryService(), operations);
        ReflectionTestUtils.setField(service, "workspaceRoot", workspace.toString());
        return service;
    }

    @Test void activeReadersAndExclusiveOperationsKeepFilesAndDatabaseIntact() throws Exception {
        var service = service();
        var first = operations.participate("project");
        var second = operations.participate("project");
        assertEquals("project_busy", assertThrows(ApiException.class, () -> service.purge("project")).getCode());
        first.close();
        first.close();
        assertThrows(ApiException.class, () -> service.purge("project"));
        second.close();
        operations.acquire("project");
        try { assertThrows(ApiException.class, () -> service.purge("project")); }
        finally { operations.release("project"); }
        verify(repository, never()).deleteProjectGraph(anyString());
        assertEquals("keep", Files.readString(workspace.resolve("project/source.txt")));
        service.purge("project");
        assertFalse(Files.exists(workspace.resolve("project")));
    }

    @Test void deletionExcludesNewWorkThroughoutDatabaseCommitAndAllowsOtherProjects() throws Exception {
        var service = service();
        var entered = new CountDownLatch(1);
        var finish = new CountDownLatch(1);
        when(repository.deleteProjectGraph("project")).thenAnswer(invocation -> {
            entered.countDown();
            assertTrue(finish.await(3, TimeUnit.SECONDS));
            return 1;
        });
        try (var executor = Executors.newSingleThreadExecutor()) {
            var deletion = executor.submit(() -> service.purge("project"));
            try {
                assertTrue(entered.await(3, TimeUnit.SECONDS));
                assertEquals("project_deleting", assertThrows(ApiException.class, () -> operations.participate("project")).getCode());
                assertEquals("project_deleting", assertThrows(ApiException.class, () -> operations.acquire("project")).getCode());
                assertThrows(ApiException.class, () -> service.purge("project"));
                try (var other = operations.participate("other")) { assertNotNull(other); }
                finish.countDown();
                deletion.get(3, TimeUnit.SECONDS);
                assertFalse(Files.exists(workspace.resolve("project")));
            } finally { finish.countDown(); }
        }
    }

    @Test void failedDatabaseDeletionReleasesAdmissionAndPreservesSource() throws Exception {
        var service = service();
        when(repository.deleteProjectGraph("project")).thenThrow(new IllegalStateException("database unavailable"));
        assertThrows(IllegalStateException.class, () -> service.purge("project"));
        assertEquals("keep", Files.readString(workspace.resolve("project/source.txt")));
        assertFalse(Files.exists(workspace.resolve("project/.fengmotion/source-write.lock")));
        try (var next = operations.participate("project")) { assertNotNull(next); }
    }

    @Test void externalPreviewWriteLockPreventsDeletion() throws Exception {
        var service = service();
        try (var write = SourceWriteGuard.acquire(workspace.resolve("project"))) {
            assertEquals("source_busy", assertThrows(ApiException.class, () -> service.purge("project")).getCode());
            verify(repository, never()).deleteProjectGraph(anyString());
            assertTrue(Files.exists(workspace.resolve("project/source.txt")));
        }
        service.purge("project");
        assertFalse(Files.exists(workspace.resolve("project")));
    }
}
