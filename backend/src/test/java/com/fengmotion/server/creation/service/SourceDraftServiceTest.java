package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.creation.domain.CreateRequest;
import com.fengmotion.server.project.service.ProjectSourceFingerprint;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.service.SourceWriteGuard;

class SourceDraftServiceTest {
    @TempDir Path root;
    private final CreateAgentRunner agent = mock(CreateAgentRunner.class);
    private final ProjectSourceSnapshots snapshots = spy(new ProjectSourceSnapshots());
    private final SourceDraftService service = new SourceDraftService(snapshots);
    private CreateRequest request;

    @BeforeEach void setup() throws Exception {
        Files.createDirectory(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "export const Main = () => <div>Original</div>");
        Files.writeString(root.resolve("src/obsolete.ts"), "export const old = true;");
        Files.writeString(root.resolve("AGENTS.md"), "Read the project style");
        request = new CreateRequest("修改工程", null, null, 1L, null, "draft", null, null,
                null, null, null, null, null, "draft", ProjectSourceFingerprint.compute(root), null);
    }

    @AfterEach void clearInterrupt() { Thread.interrupted(); }

    private CreateAgentRunner.AgentOutcome outcome() {
        return new CreateAgentRunner.AgentOutcome("候选已完成", 1L, true, true, true, "ignored", "ignored");
    }

    private CreateAgentRunner.AgentOutcome run() {
        return service.run(root, request, "仅修改工作稿", ResourceContextBuilder.ResourceContext.EMPTY, agent, "project");
    }

    @Test void appliesMultipleSourceChangesAfterAgentFinishesAndCleansTemporaryCopies() throws Exception {
        var candidatePath = new AtomicReference<Path>();
        when(agent.run(any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(invocation -> {
            Path candidate = invocation.getArgument(0);
            candidatePath.set(candidate);
            assertNotEquals(root, candidate);
            assertEquals("Read the project style", Files.readString(candidate.resolve("AGENTS.md")));
            Files.writeString(candidate.resolve("src/index.tsx"), "export const Main = () => <div>Changed</div>");
            Files.delete(candidate.resolve("src/obsolete.ts"));
            Files.writeString(candidate.resolve("src/new.ts"), "export const added = true;");
            Files.createDirectory(candidate.resolve("public"));
            Files.writeString(candidate.resolve("public/asset.txt"), "new asset");
            Files.writeString(candidate.resolve("AGENTS.md"), "this must not replace the real guide");
            assertTrue(Files.readString(root.resolve("src/index.tsx")).contains("Original"));
            assertTrue(Files.exists(root.resolve("src/obsolete.ts")));
            return outcome();
        });
        var result = run();
        assertTrue(result.changed());
        assertEquals(request.sourceHash(), result.beforeHash());
        assertEquals(ProjectSourceFingerprint.compute(root), result.afterHash());
        assertTrue(Files.readString(root.resolve("src/index.tsx")).contains("Changed"));
        assertFalse(Files.exists(root.resolve("src/obsolete.ts")));
        assertTrue(Files.exists(root.resolve("src/new.ts")));
        assertEquals("new asset", Files.readString(root.resolve("public/asset.txt")));
        assertEquals("Read the project style", Files.readString(root.resolve("AGENTS.md")));
        assertFalse(Files.exists(candidatePath.get()));
        assertFalse(Files.exists(root.resolve(".fengmotion/source-write.lock")));
        try (var files = Files.list(root.resolve(".fengmotion/source-snapshots"))) { assertEquals(0, files.count()); }
        try (var files = Files.list(root.resolve(".fengmotion/restore-backups"))) { assertEquals(0, files.count()); }
    }

    @Test void failedAgentDiscardsItsPartialEdits() throws Exception {
        var candidatePath = new AtomicReference<Path>();
        when(agent.run(any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(invocation -> {
            Path candidate = invocation.getArgument(0);
            candidatePath.set(candidate);
            Files.writeString(candidate.resolve("src/index.tsx"), "partial edit");
            throw new IllegalStateException("agent failed");
        });
        assertThrows(IllegalStateException.class, this::run);
        assertEquals(request.sourceHash(), ProjectSourceFingerprint.compute(root));
        assertFalse(Files.exists(candidatePath.get()));
    }

    @Test void manualEditDuringGenerationRejectsTheCandidateAndPreservesTheManualEdit() throws Exception {
        when(agent.run(any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(invocation -> {
            Path candidate = invocation.getArgument(0);
            Files.writeString(candidate.resolve("src/index.tsx"), "AI edit");
            Files.writeString(root.resolve("src/index.tsx"), "manual edit while agent runs");
            return outcome();
        });
        assertEquals("source_changed", assertThrows(ApiException.class, this::run).getCode());
        assertEquals("manual edit while agent runs", Files.readString(root.resolve("src/index.tsx")));
        assertTrue(Files.exists(root.resolve("src/obsolete.ts")));
        assertFalse(Files.exists(root.resolve(".fengmotion/source-write.lock")));
    }

    @Test void previewWriterLockRejectsCandidateApplication() throws Exception {
        when(agent.run(any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(invocation -> {
            Path candidate = invocation.getArgument(0);
            Files.writeString(candidate.resolve("src/index.tsx"), "AI edit");
            return outcome();
        });
        try (var guard = SourceWriteGuard.acquire(root)) {
            assertEquals("source_busy", assertThrows(ApiException.class, this::run).getCode());
            assertEquals(request.sourceHash(), ProjectSourceFingerprint.compute(root));
        }
    }

    @Test void failureAfterApplyingFilesRollsBackTheWholeSourceSet() throws Exception {
        when(agent.run(any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(invocation -> {
            Path candidate = invocation.getArgument(0);
            Files.writeString(candidate.resolve("src/index.tsx"), "AI edit");
            Files.delete(candidate.resolve("src/obsolete.ts"));
            return outcome();
        });
        doAnswer(invocation -> {
            ProjectSourceSnapshots.Recovery recovery = spy((ProjectSourceSnapshots.Recovery) invocation.callRealMethod());
            assertEquals("AI edit", Files.readString(root.resolve("src/index.tsx")));
            doThrow(new IllegalStateException("injected apply failure")).when(recovery).commitAndDiscardBackup();
            return recovery;
        }).when(snapshots).restore(any(), any(), any());
        assertThrows(IllegalStateException.class, this::run);
        assertEquals(request.sourceHash(), ProjectSourceFingerprint.compute(root));
        assertTrue(Files.exists(root.resolve("src/obsolete.ts")));
        assertFalse(Files.exists(root.resolve(".fengmotion/source-write.lock")));
    }

    @Test void interruptedAgentCannotApplyItsCandidate() throws Exception {
        when(agent.run(any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(invocation -> {
            Path candidate = invocation.getArgument(0);
            Files.writeString(candidate.resolve("src/index.tsx"), "cancelled edit");
            Thread.currentThread().interrupt();
            return outcome();
        });
        assertEquals("creation_cancelled", assertThrows(ApiException.class, this::run).getCode());
        Thread.interrupted();
        assertEquals(request.sourceHash(), ProjectSourceFingerprint.compute(root));
    }

    @Test void noSourceChangeDoesNotTrustTheAgentsChangedFlag() throws Exception {
        when(agent.run(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(outcome());
        assertFalse(run().changed());
        assertEquals(request.sourceHash(), ProjectSourceFingerprint.compute(root));
        verify(snapshots, never()).restore(any(), any(), any());
    }

    @Test void cancellationTokenSurvivesAnAgentThatClearsTheThreadInterrupt() throws Exception {
        var cancelled = new java.util.concurrent.atomic.AtomicBoolean();
        when(agent.run(any(), any(), any(), any(), any(), any(), any(), any())).thenAnswer(invocation -> {
            Path candidate = invocation.getArgument(0);
            Files.writeString(candidate.resolve("src/index.tsx"), "cancelled edit");
            cancelled.set(true);
            Thread.currentThread().interrupt();
            Thread.interrupted();
            return outcome();
        });
        try (var cancellation = CreationCancellation.watch(cancelled::get)) {
            assertEquals("creation_cancelled", assertThrows(ApiException.class, this::run).getCode());
        }
        assertEquals(request.sourceHash(), ProjectSourceFingerprint.compute(root));
        CreationCancellation.requireRunning();
    }
}
