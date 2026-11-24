package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fengmotion.server.common.ApiException;

class SourceEditSessionTest {
    @TempDir Path root;
    private SourceEditSession open() throws Exception {
        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "original");
        return SourceEditSession.open(new ProjectSourceSnapshots(), root, null);
    }
    @Test void onlyAppliedCandidatesChangeTheOriginal() throws Exception {
        Path discarded;
        try (var edit = open()) {
            discarded = edit.path();
            Files.writeString(edit.path().resolve("src/index.tsx"), "failed candidate");
        }
        assertFalse(Files.exists(discarded));
        assertEquals("original", Files.readString(root.resolve("src/index.tsx")));
        try (var edit = open()) {
            Files.writeString(edit.path().resolve("src/index.tsx"), "accepted candidate");
            assertNotEquals(edit.beforeHash(), edit.apply(() -> false));
        }
        assertEquals("accepted candidate", Files.readString(root.resolve("src/index.tsx")));
    }
    @Test void conflictsAndCancellationKeepOriginalSource() throws Exception {
        try (var edit = open()) {
            Files.writeString(edit.path().resolve("src/index.tsx"), "candidate");
            assertEquals("creation_cancelled",assertThrows(ApiException.class,()->edit.apply(()->true)).getCode());
            Files.writeString(root.resolve("src/index.tsx"), "new manual edit");
            assertEquals("source_changed",assertThrows(ApiException.class,()->edit.apply(()->false)).getCode());
        }
        assertEquals("new manual edit",Files.readString(root.resolve("src/index.tsx")));
    }

    @Test void unchangedCandidateCannotReportAnObsoleteWorkingHashAsCurrent() throws Exception {
        try (var edit = open()) {
            Files.writeString(root.resolve("src/index.tsx"), "new manual edit");
            assertEquals("source_changed", assertThrows(ApiException.class, () -> edit.apply(() -> false)).getCode());
            assertEquals("new manual edit", Files.readString(root.resolve("src/index.tsx")));
        }
    }

    @Test void sourceSymlinksAreRejectedBeforeSnapshotRead() throws Exception {
        Files.createDirectories(root.resolve("src"));
        Path outside=Files.writeString(root.resolve("external.txt"),"private");
        Files.createSymbolicLink(root.resolve("src/link.txt"),outside);
        assertTrue(ProjectSourceFingerprint.compute(root).startsWith("error:"));
        assertThrows(ApiException.class,()->SourceEditSession.open(new ProjectSourceSnapshots(),root,null));
        assertEquals("private",Files.readString(outside));
    }

    @Test void rootLevelEntriesAndComponentsParticipateInCopyWritebackAndRollback() throws Exception {
        Files.writeString(root.resolve("index.tsx"),"root entry");
        Files.writeString(root.resolve("theme.json"),"{\"color\":\"blue\"}");
        Files.writeString(root.resolve("creation-state.json"),"preserve state");
        Files.createDirectory(root.resolve("components"));
        Files.writeString(root.resolve("components/Title.tsx"),"title");
        var snapshots=new ProjectSourceSnapshots();
        String before=ProjectWorktreeService.fingerprint(root);
        String saved=snapshots.capture(root);
        try(var edit=SourceEditSession.open(snapshots,root,before)) {
            assertEquals("root entry",Files.readString(edit.path().resolve("index.tsx")));
            assertEquals("title",Files.readString(edit.path().resolve("components/Title.tsx")));
            Files.writeString(edit.path().resolve("index.tsx"),"changed root");
            Files.delete(edit.path().resolve("theme.json"));
            Files.writeString(edit.path().resolve("New.tsx"),"new component");
            edit.apply(()->false);
        }
        assertEquals("changed root",Files.readString(root.resolve("index.tsx")));
        assertTrue(Files.exists(root.resolve("New.tsx")));
        assertFalse(Files.exists(root.resolve("theme.json")));
        try(var write=SourceWriteGuard.acquire(root);var recovery=snapshots.restore(root,saved,before)) { recovery.commit(); }
        assertEquals(before,ProjectWorktreeService.fingerprint(root));
        assertFalse(Files.exists(root.resolve("New.tsx")));
        assertEquals("preserve state",Files.readString(root.resolve("creation-state.json")));
    }

    @Test void legacySnapshotCannotDeletePreviouslyUntrackedRootFiles() throws Exception {
        Files.createDirectory(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "original");
        var snapshots = new ProjectSourceSnapshots();
        String before = ProjectWorktreeService.fingerprint(root);
        String saved = snapshots.capture(root);
        Files.delete(root.resolve(saved).resolve(".source-layout"));
        Files.writeString(root.resolve("src/index.tsx"), "current");
        Files.writeString(root.resolve("theme.json"), "untracked in old snapshots");
        assertEquals("source_snapshot_scope_unknown", assertThrows(ApiException.class,
                () -> snapshots.restore(root, saved, before)).getCode());
        assertEquals("current", Files.readString(root.resolve("src/index.tsx")));
        assertEquals("untracked in old snapshots", Files.readString(root.resolve("theme.json")));
        assertFalse(Files.exists(root.resolve(".fengmotion/restore-backups")));
        Files.delete(root.resolve("theme.json"));
        try (var recovery = snapshots.restore(root, saved, before)) { recovery.commit(); }
        assertEquals(before, ProjectWorktreeService.fingerprint(root));
    }

    @Test void unknownSnapshotLayoutCannotBeRestored() throws Exception {
        try (var edit = open()) { }
        var snapshots = new ProjectSourceSnapshots();
        String before = ProjectWorktreeService.fingerprint(root);
        String saved = snapshots.capture(root);
        Files.writeString(root.resolve(saved).resolve(".source-layout"), "3");
        assertEquals("snapshot_corrupt", assertThrows(ApiException.class,
                () -> snapshots.restore(root, saved, before)).getCode());
        assertEquals(before, ProjectWorktreeService.fingerprint(root));
    }

    @Test void largeRootFileSetDoesNotLeaveAnUnreadableRecoveryJournal() throws Exception {
        for (int index = 0; index < 150; index++) Files.writeString(root.resolve("Component" + index + ".tsx"), "original");
        var snapshots = new ProjectSourceSnapshots();
        String hash = ProjectWorktreeService.fingerprint(root);
        String saved = snapshots.capture(root);
        Files.writeString(root.resolve("Component0.tsx"), "changed");
        try (var guard = SourceWriteGuard.acquire(root); var recovery = snapshots.restore(root, saved, hash)) { recovery.commit(); }
        try (var journals = Files.walk(root.resolve(".fengmotion/restore-backups"))) {
            Path journal = journals.filter(file -> file.getFileName().toString().equals("recovery.json")).findFirst().orElseThrow();
            assertTrue(Files.size(journal) > 16384);
        }
        try (var guard = SourceWriteGuard.acquire(root)) { assertEquals(hash, ProjectWorktreeService.fingerprint(root)); }
    }

    @Test void rollbackDoesNotOverwriteExternalChangesMadeAfterApplication() throws Exception {
        try (var edit = open()) { }
        var snapshots = new ProjectSourceSnapshots();
        String original = ProjectWorktreeService.fingerprint(root);
        String baseline = snapshots.capture(root);
        try (var workspace = snapshots.createWorkspace(root, baseline, original)) {
            Files.writeString(workspace.path().resolve("src/index.tsx"), "candidate");
            String hash = ProjectWorktreeService.fingerprint(workspace.path());
            String candidate = snapshots.capture(root, workspace.path());
            var recovery = snapshots.restore(root, candidate, hash);
            Files.writeString(root.resolve("src/index.tsx"), "manual after apply");
            assertThrows(java.io.IOException.class, recovery::close);
            assertEquals("manual after apply", Files.readString(root.resolve("src/index.tsx")));
            assertEquals("source_recovery_required", assertThrows(ApiException.class, () -> SourceWriteGuard.acquire(root)).getCode());
        }
    }

    @Test void rollbackDoesNotRecreateAnExternallyDeletedAppliedEntry() throws Exception {
        Files.writeString(root.resolve("index.tsx"), "original");
        var snapshots = new ProjectSourceSnapshots();
        String original = ProjectWorktreeService.fingerprint(root);
        String baseline = snapshots.capture(root);
        try (var workspace = snapshots.createWorkspace(root, baseline, original)) {
            Files.writeString(workspace.path().resolve("index.tsx"), "candidate");
            String hash = ProjectWorktreeService.fingerprint(workspace.path());
            String candidate = snapshots.capture(root, workspace.path());
            var recovery = snapshots.restore(root, candidate, hash);
            Files.delete(root.resolve("index.tsx"));
            assertThrows(java.io.IOException.class, recovery::close);
            assertFalse(Files.exists(root.resolve("index.tsx")));
            assertEquals("source_recovery_required", assertThrows(ApiException.class, () -> SourceWriteGuard.acquire(root)).getCode());
        }
    }
}
