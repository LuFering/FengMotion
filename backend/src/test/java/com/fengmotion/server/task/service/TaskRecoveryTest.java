package com.fengmotion.server.task.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.store.TaskRepository;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class TaskRecoveryTest {
    @Autowired TaskRecovery recovery;
    @Autowired TaskRepository tasks;
    @Autowired ProjectRepository projects;
    @Autowired ProjectSceneRepository scenes;
    @Autowired ObjectMapper json;

    private String project() {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "恢复测试", "explainer", null, "/tmp/unused", Instant.now()));
        return id;
    }

    private Task task(String projectId, String status) {
        Instant now = Instant.now();
        return new Task(UUID.randomUUID().toString(), projectId, "modify", status, "测试", null,
                55, "执行中", null, null, now, now, null, 0L, null);
    }

    private ExecutionOwner exitedOwner(ExecutionOwner local) throws Exception {
        Process process = new ProcessBuilder("/bin/sh", "-c", "exit 0").start();
        long pid = process.pid();
        process.waitFor();
        assumeTrue(ProcessHandle.of(pid).isEmpty(), "测试 PID 已被复用");
        return new ExecutionOwner(local.machine(), local.boot(), local.namespace(), local.uid(), pid, Instant.now());
    }

    @Test
    void liveOrUnverifiableOwnerIsNeverDeclaredStopped() {
        var current = ExecutionOwner.current();
        assumeTrue(current.isPresent(), "需要可识别的 Linux 进程身份");
        var local = current.get();
        var reusedPid = new ExecutionOwner(local.machine(), local.boot(), local.namespace(), local.uid(), local.pid(), Instant.EPOCH);
        assertFalse(reusedPid.definitelyStoppedComparedTo(local));
        var differentBoot = new ExecutionOwner(local.machine(), "another-boot", local.namespace(), local.uid(), Long.MAX_VALUE, Instant.EPOCH);
        assertFalse(differentBoot.definitelyStoppedComparedTo(local));
        var differentUid = new ExecutionOwner(local.machine(), local.boot(), local.namespace(), "different-uid", Long.MAX_VALUE, Instant.EPOCH);
        assertFalse(differentUid.definitelyStoppedComparedTo(local));
        assertTrue(ExecutionOwner.decode("invalid").isEmpty());
    }

    @Test
    void stoppedOwnerIsRecoveredOnceWhileLiveAndUnknownOwnersAreUntouched() throws Exception {
        var local = ExecutionOwner.current();
        assumeTrue(local.isPresent(), "需要可识别的 Linux 进程身份");
        String project = project();
        Task dead = task(project, Task.STATUS_BUILDING);
        Task live = task(project, Task.STATUS_RUNNING);
        Task legacy = task(project, Task.STATUS_QUEUED);
        Task otherNamespace = task(project, Task.STATUS_RUNNING);
        tasks.save(dead, exitedOwner(local.get()).encode());
        tasks.save(live, local.get().encode());
        tasks.save(legacy);
        var different = new ExecutionOwner(local.get().machine(), local.get().boot(), "pid:[other]", local.get().uid(), dead.id().hashCode() & 0x7fffffffL, Instant.now());
        tasks.save(otherNamespace, different.encode());

        recovery.recover();
        recovery.recover();

        Task after = tasks.findById(dead.id()).orElseThrow();
        assertEquals(Task.STATUS_FAILED, after.status());
        assertEquals("service_interrupted", after.errorCode());
        assertNotNull(after.finishedAt());
        assertEquals(1, tasks.findEventsAfter(dead.id(), 0).size());
        assertEquals(Task.STATUS_RUNNING, tasks.findById(live.id()).orElseThrow().status());
        assertEquals(Task.STATUS_QUEUED, tasks.findById(legacy.id()).orElseThrow().status());
        assertEquals(Task.STATUS_RUNNING, tasks.findById(otherNamespace.id()).orElseThrow().status());
    }

    @Test
    void recoveredTaskRetainsAlreadyCommittedSceneAndArtifact() throws Exception {
        var local = ExecutionOwner.current();
        assumeTrue(local.isPresent(), "需要可识别的 Linux 进程身份");
        String project = project();
        Task interrupted = task(project, Task.STATUS_BUILDING);
        tasks.save(interrupted, exitedOwner(local.get()).encode());
        var film = json.readTree("{\"scenes\":[{\"id\":\"s1\",\"text\":\"已提交\"}]}");
        assertEquals(1L, scenes.commitWithSnapshot(project, 0, film, interrupted.id(), "", "",
                "renders/committed.mp4", ProjectSceneVersion.SOURCE_TASK, null).orElseThrow());

        recovery.recover();

        Task recovered = tasks.findById(interrupted.id()).orElseThrow();
        assertEquals(Task.STATUS_FAILED, recovered.status());
        assertEquals(1L, recovered.resultVersion());
        assertEquals("renders/committed.mp4", recovered.artifactPath());
        assertTrue(tasks.findEventsAfter(interrupted.id(), 0).get(0).data().path("artifactApplied").asBoolean());
    }
}
