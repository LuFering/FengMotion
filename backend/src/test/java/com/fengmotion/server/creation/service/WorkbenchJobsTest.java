package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.store.LocalStateStore;
import com.fengmotion.server.project.store.ProjectRepository;

class WorkbenchJobsTest {
    @TempDir Path root;
    private final ObjectMapper json=new ObjectMapper();
    private final ProjectRepository projects=mock(ProjectRepository.class);
    private final ProjectTimelineService timelines=mock(ProjectTimelineService.class);
    private final ShotCandidateService candidates=mock(ShotCandidateService.class);
    private final ProjectOperationLock operations=new ProjectOperationLock();
    private LocalStateStore store;
    private WorkbenchJobs jobs;
    @BeforeEach void setup() throws Exception {
        store=spy(new LocalStateStore(new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:"+root.resolve("jobs.db"))),json));
        var init=LocalStateStore.class.getDeclaredMethod("init");init.setAccessible(true);init.invoke(store);
        when(projects.findById(anyString())).thenAnswer(call->Optional.of(new Project(call.getArgument(0),"Film",null,null,root.toString(),Instant.now())));
        jobs=new WorkbenchJobs(store,projects,operations,timelines,candidates,json);
    }
    @AfterEach void close() { jobs.close(); }
    private WorkbenchJobs.Request request(String id) { return new WorkbenchJobs.Request(id,"timeline_recovery","renders/a.mp4",null,null,null); }
    private WorkbenchJobs.Job await(String id) throws Exception {
        for(int attempt=0;attempt<200;attempt++) {
            var state=jobs.get("project",id);
            if(!java.util.List.of("accepted","running").contains(state.state())) return state;
            Thread.sleep(10);
        }
        throw new AssertionError("job unfinished");
    }
    @Test void durableReplayDoesNotExecuteAgainAndRejectsOtherIdentity() throws Exception {
        when(timelines.recover(any(),any())).thenReturn(json.createObjectNode().put("fps",30));
        jobs.submit("project",request("one"));
        assertEquals("completed",await("one").state());
        assertEquals(30,jobs.submit("project",request("one")).result().path("fps").asInt());
        assertEquals("task_idempotency_conflict",assertThrows(ApiException.class,()->jobs.submit("other",request("one"))).getCode());
        verify(timelines,times(1)).recover("project","renders/a.mp4");
        assertEquals(1,jobs.list("project").size());
    }

    @Test void nonexistentProjectIsNotReportedAsAnEmptyJobList() {
        when(projects.findById("missing")).thenReturn(Optional.empty());
        assertEquals("not_found", assertThrows(ApiException.class, () -> jobs.list("missing")).getCode());
        try (var deletion = operations.beginDeletion("project")) {
            assertEquals("project_deleting", assertThrows(ApiException.class, () -> jobs.list("project")).getCode());
        }
    }

    @Test void verificationIsDurableAndCompletedDoesNotMeanPassed() throws Exception {
        var verification = mock(VersionVerificationService.class);
        org.springframework.test.util.ReflectionTestUtils.setField(jobs, "verification", verification);
        when(verification.verify("project", 1)).thenReturn(new VersionVerificationService.Report("project", 1, "video.mp4", "hash",
                "technical-integrity-v1", "failed", "not_run", java.util.List.of(), Instant.now().toString()));
        var request = new WorkbenchJobs.Request("verify", "version_verify", null, 1L, null, null);
        jobs.submit("project", request);
        assertEquals("completed", await("verify").state());
        assertEquals("failed", jobs.get("project", "verify").result().path("conclusion").asText());
        jobs.submit("project", request);
        verify(verification, times(1)).verify("project", 1);
        var data = json.createObjectNode().put("state", "running").put("createdAt", Instant.now().toString());
        data.set("request", json.valueToTree(new WorkbenchJobs.Request("crash-verify", "version_verify", null, 1L, null, null)));
        store.put("workbench-job", "crash-verify", "project", 0, data, false);
        assertEquals("interrupted", jobs.get("project", "crash-verify").state());
        verifyNoMoreInteractions(verification);
    }
    @Test void cancellationKeepsDeletionBlockedUntilWorkerCleanup() throws Exception {
        var entered=new CountDownLatch(1);
        when(timelines.recover(any(),any())).thenAnswer(call->{ entered.countDown();Thread.sleep(10_000);return null; });
        jobs.submit("project",request("cancel"));
        assertTrue(entered.await(3,TimeUnit.SECONDS));
        assertThrows(ApiException.class,()->operations.beginDeletion("project"));
        jobs.cancel("project","cancel");
        assertEquals("cancelled",await("cancel").state());
        assertEquals("cancelled",jobs.submit("project",request("cancel")).state());
    }
    @Test void restartExposesInterruptedWorkWithoutAutomaticReplay() {
        var data=json.createObjectNode().put("state","running").put("createdAt",Instant.now().toString());
        data.set("request",json.valueToTree(request("crash")));
        store.put("workbench-job","crash","project",0,data,false);
        assertEquals("interrupted",jobs.get("project","crash").state());
        assertEquals("interrupted",jobs.submit("project",request("crash")).state());
        verify(timelines).read("project","renders/a.mp4");
        verify(timelines,never()).recover(any(),any());
        verifyNoInteractions(candidates);
    }

    @Test void lostReceiptRecoversExistingResultWithoutRepeatingTheOperation() {
        var data=json.createObjectNode().put("state","running").put("createdAt",Instant.now().toString());
        data.set("request",json.valueToTree(request("receipt")));
        store.put("workbench-job","receipt","project",0,data,false);
        when(timelines.read("project","renders/a.mp4")).thenReturn(json.createObjectNode().put("recovered",true));
        assertEquals("completed",jobs.get("project","receipt").state());
        assertTrue(jobs.submit("project",request("receipt")).result().path("recovered").asBoolean());
        verify(timelines,never()).recover(any(),any());
    }

    @Test void lostCompletionWriteRetriesReceiptWithoutRepeatingWork() throws Exception {
        var firstFailure=new java.util.concurrent.atomic.AtomicBoolean(true);
        doAnswer(call->{
            com.fasterxml.jackson.databind.JsonNode data=call.getArgument(4);
            if(data.path("state").asText().equals("completed") && firstFailure.getAndSet(false)) throw new IllegalStateException("receipt storage failed");
            return call.callRealMethod();
        }).when(store).put(eq("workbench-job"),anyString(),anyString(),anyLong(),any(),anyBoolean());
        when(timelines.recover(any(),any())).thenReturn(json.createObjectNode().put("recovered",true));
        jobs.submit("project",request("retry-receipt"));
        assertEquals("completed",await("retry-receipt").state());
        assertTrue(jobs.get("project","retry-receipt").result().path("recovered").asBoolean());
        verify(timelines,times(1)).recover("project","renders/a.mp4");
    }

    @Test void queuedCancellationAndShutdownReleaseProjectLeases() throws Exception {
        var entered=new CountDownLatch(2);
        when(timelines.recover(any(),any())).thenAnswer(call->{entered.countDown();Thread.sleep(10_000);return null;});
        jobs.submit("one",request("one"));
        jobs.submit("two",request("two"));
        assertTrue(entered.await(3,TimeUnit.SECONDS));
        jobs.submit("project",request("queued"));
        assertEquals("cancelled",jobs.cancel("project","queued").state());
        try(var deletion=operations.beginDeletion("project")) { assertNotNull(deletion); }
        jobs.submit("project",request("shutdown"));
        jobs.close();
        assertEquals("interrupted",jobs.get("project","shutdown").state());
        try(var deletion=operations.beginDeletion("project")) { assertNotNull(deletion); }
        verify(timelines,never()).recover(eq("project"),any());
    }
}
