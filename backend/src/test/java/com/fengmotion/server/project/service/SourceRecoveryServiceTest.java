package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

class SourceRecoveryServiceTest {
    @TempDir Path root;
    private final ObjectMapper json = new ObjectMapper();
    private final ProjectSourceSnapshots snapshots = new ProjectSourceSnapshots();
    private final ProjectSceneRepository scenes = mock(ProjectSceneRepository.class);
    private SourceRecoveryService service;
    private long deadPid;
    private String beforeHash;

    @BeforeEach void setup() throws Exception {
        Files.createDirectory(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"),"original");
        beforeHash = ProjectWorktreeService.fingerprint(root);
        var projects = mock(ProjectRepository.class);
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project","Film",null,null,root.toString(),Instant.now())));
        service = new SourceRecoveryService(projects,new ProjectOperationLock(),snapshots,json,scenes);
        var process = new ProcessBuilder("sh","-c","exit 0").start();
        deadPid = process.pid();
        assertEquals(0,process.waitFor());
    }

    private Path interruptedWrite() throws Exception {
        String baseline = snapshots.capture(root);
        try (var workspace = snapshots.createWorkspace(root,baseline,beforeHash)) {
            Files.writeString(workspace.path().resolve("src/index.tsx"),"candidate");
            String hash = ProjectWorktreeService.fingerprint(workspace.path());
            String candidate = snapshots.capture(root,workspace.path());
            snapshots.restore(root,candidate,hash);
        }
        Path backup;
        try (var paths = Files.list(root.resolve(".fengmotion/restore-backups"))) { backup = paths.findFirst().orElseThrow(); }
        ObjectNode journal = (ObjectNode)json.readTree(Files.readString(backup.resolve("recovery.json")));
        journal.put("pid",deadPid);
        Files.writeString(backup.resolve("recovery.json"),journal.toString());
        return backup;
    }

    @Test void abandonedLockRequiresMatchingTokenAndDeadOwner() throws Exception {
        try (var guard = SourceWriteGuard.acquire(root)) {
            var state = service.inspect("project");
            assertTrue(state.lock().alive());
            assertEquals("source_busy",assertThrows(ApiException.class,()->service.recover("project",new SourceRecoveryService.Request(state.sourceHash(),state.lock().token(),null))).getCode());
        }
        Path lock = Files.createDirectories(root.resolve(".fengmotion/source-write.lock"));
        String token = UUID.randomUUID().toString();
        Files.writeString(lock.resolve("owner.json"),json.createObjectNode().put("pid",deadPid).put("token",token).toString());
        assertThrows(ApiException.class,()->service.recover("project",new SourceRecoveryService.Request(beforeHash,"wrong",null)));
        assertNull(service.recover("project",new SourceRecoveryService.Request(beforeHash,token,null)).lock());
        assertFalse(Files.exists(lock));
        assertEquals(beforeHash,ProjectWorktreeService.fingerprint(root));
    }

    @Test void corruptedLockRecordsReturnExplicitErrorWithoutChangingSource() throws Exception {
        Path lock=Files.createDirectories(root.resolve(".fengmotion/source-write.lock"));
        for(String contents:java.util.List.of("","null","[]","{\"pid\":1,\"pid\":2}")) {
            Files.writeString(lock.resolve("owner.json"),contents);
            assertEquals("source_recovery_invalid",assertThrows(ApiException.class,()->service.inspect("project")).getCode());
            assertEquals(beforeHash,ProjectWorktreeService.fingerprint(root));
        }
    }

    @Test void sameBackendCanResolveAnUncertainCommitAfterItsWriteLeaseIsReleased() throws Exception {
        Path backup=interruptedWrite();
        ObjectNode journal=(ObjectNode)json.readTree(Files.readString(backup.resolve("recovery.json")));
        journal.put("pid",ProcessHandle.current().pid());
        Files.writeString(backup.resolve("recovery.json"),journal.toString());
        var state=service.inspect("project");
        assertTrue(state.recoveries().getFirst().ownerAlive());
        var result=service.recover("project",new SourceRecoveryService.Request(state.sourceHash(),null,backup.getFileName().toString()));
        assertEquals(beforeHash,result.sourceHash());
    }

    @Test void recoversUncommittedWriteWithoutAddingVersions() throws Exception {
        Path backup = interruptedWrite();
        var state = service.inspect("project");
        assertEquals(1,state.recoveries().size());
        assertEquals("source_recovery_required",assertThrows(ApiException.class,()->SourceWriteGuard.acquire(root)).getCode());
        assertFalse(state.recoveries().getFirst().ownerAlive());
        var result = service.recover("project",new SourceRecoveryService.Request(state.sourceHash(),null,backup.getFileName().toString()));
        assertEquals(beforeHash,result.sourceHash());
        assertTrue(result.recoveries().isEmpty());
        assertEquals(beforeHash,service.recover("project",new SourceRecoveryService.Request(state.sourceHash(),null,backup.getFileName().toString())).sourceHash());
        verify(scenes,never()).commitWithSnapshot(any(),anyLong(),any(),any(),any(),any(),any(),any(),any());
    }

    @Test void userEditsAfterCrashAreNotOverwritten() throws Exception {
        Path backup = interruptedWrite();
        Files.writeString(root.resolve("src/index.tsx"),"manual after crash");
        var state = service.inspect("project");
        assertEquals("recovery_manual_required",assertThrows(ApiException.class,()->service.recover("project",new SourceRecoveryService.Request(state.sourceHash(),null,backup.getFileName().toString()))).getCode());
        assertEquals("manual after crash",Files.readString(root.resolve("src/index.tsx")));
    }

    @Test void corruptedCurrentSceneIsNotMistakenForACommittedCandidate() throws Exception {
        Path backup = interruptedWrite();
        var state = service.inspect("project");
        when(scenes.find("project")).thenReturn(Optional.of(new ProjectScene("project", 1, null, null, Instant.now())));
        assertEquals(beforeHash, service.recover("project", new SourceRecoveryService.Request(
                state.sourceHash(), null, backup.getFileName().toString())).sourceHash());
    }

    @Test void versionAlreadyCommittedKeepsNewSource() throws Exception {
        Path backup = interruptedWrite();
        String hash = ProjectWorktreeService.fingerprint(root);
        when(scenes.find("project")).thenReturn(Optional.of(new ProjectScene("project",2,json.createObjectNode().put("sourceHash",hash),null,Instant.now())));
        var result=service.recover("project",new SourceRecoveryService.Request(hash,null,backup.getFileName().toString()));
        assertEquals(hash,result.sourceHash());
        assertTrue(result.recoveries().isEmpty());
        assertEquals("candidate",Files.readString(root.resolve("src/index.tsx")));
    }

    @Test void partialDirectoryReplacementCanRecoverFromVerifiedOriginalCopy() throws Exception {
        Path backup=interruptedWrite();
        Files.move(root.resolve("src"),backup.resolve("staged/src"));
        ObjectNode journal=(ObjectNode)json.readTree(Files.readString(backup.resolve("recovery.json")));
        journal.put("state","prepared").put("replacing","src");
        Files.writeString(backup.resolve("recovery.json"),journal.toString());
        String hash=ProjectWorktreeService.fingerprint(root);
        var result=service.recover("project",new SourceRecoveryService.Request(hash,null,backup.getFileName().toString()));
        assertEquals(beforeHash,result.sourceHash());
    }

    @Test void laterDeletionIsNotMistakenForInterruptedDirectoryMove() throws Exception {
        Path backup=interruptedWrite();
        Files.delete(root.resolve("src/index.tsx"));
        Files.delete(root.resolve("src"));
        String hash=ProjectWorktreeService.fingerprint(root);
        assertEquals("recovery_manual_required",assertThrows(ApiException.class,()->service.recover("project",
                new SourceRecoveryService.Request(hash,null,backup.getFileName().toString()))).getCode());
        assertFalse(Files.exists(root.resolve("src")));
    }

    @Test void forciblyKilledWriterCanBeRecoveredWithItsActualOwnerIdentity() throws Exception {
        String javaBinary=Path.of(System.getProperty("java.home"),"bin","java").toString();
        Path log=root.resolve("child.log");
        var child=new ProcessBuilder(javaBinary,"-cp",System.getProperty("java.class.path"),CrashWriter.class.getName(),root.toString())
                .redirectOutput(log.toFile()).redirectErrorStream(true).start();
        try {
            for(int attempt=0;attempt<100;attempt++) {
                if(Files.exists(log) && Files.readString(log).contains("READY")) break;
                if(!child.isAlive()) fail(Files.readString(log));
                Thread.sleep(50);
            }
            assertTrue(Files.readString(log).contains("READY"));
            assertTrue(service.inspect("project").lock().alive());
            child.destroyForcibly();
            assertTrue(child.waitFor(5,java.util.concurrent.TimeUnit.SECONDS));
            var state=service.inspect("project");
            assertFalse(state.lock().alive());
            var result=service.recover("project",new SourceRecoveryService.Request(state.sourceHash(),state.lock().token(),state.recoveries().getFirst().id()));
            assertEquals(beforeHash,result.sourceHash());
            assertTrue(result.recoveries().isEmpty());
        } finally { child.destroyForcibly();child.waitFor(); }
    }

    public static class CrashWriter {
        public static void main(String[] args) throws Exception {
            Path root=Path.of(args[0]);
            var snapshots=new ProjectSourceSnapshots();
            String hash=ProjectWorktreeService.fingerprint(root);
            String baseline=snapshots.capture(root);
            try(var edit=snapshots.createWorkspace(root,baseline,hash);var guard=SourceWriteGuard.acquire(root)) {
                Files.writeString(edit.path().resolve("src/index.tsx"),"crash candidate");
                String candidate=snapshots.capture(root,edit.path());
                snapshots.restore(root,candidate,ProjectWorktreeService.fingerprint(edit.path()));
                System.out.println("READY");System.out.flush();
                Thread.sleep(60_000);
            }
        }
    }
}
