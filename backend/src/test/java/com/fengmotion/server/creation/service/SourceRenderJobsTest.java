package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.SourceRenderRequest;
import com.fengmotion.server.project.service.*;
import com.fengmotion.server.project.store.*;
import com.fengmotion.server.render.service.ProjectFilmRenderer;

class SourceRenderJobsTest {
    @TempDir Path temporary;
    private final ObjectMapper json = new ObjectMapper();
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final ProjectFilmRenderer renderer = mock(ProjectFilmRenderer.class);
    private final ProjectOperationLock operations = new ProjectOperationLock();
    private Path root;
    private LocalStateStore documents;
    private ProjectSceneRepository scenes;
    private ProjectWorktreeService worktrees;
    private ProjectFilmRenderService filmRenders;
    private SourceRenderJobs jobs;

    @BeforeEach void setup() throws Exception {
        root = Files.createDirectories(temporary.resolve("project/src")).getParent();
        Files.writeString(root.resolve("src/index.tsx"), "export const Main = () => <div>Original</div>");
        Files.writeString(root.resolve("film.config.json"), "{\"entry\":\"src/index.tsx\",\"compositionId\":\"Main\"}");
        var dataSource = new DriverManagerDataSource("jdbc:sqlite:" + temporary.resolve("jobs.db"));
        new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(dataSource);
        var jdbc = new JdbcTemplate(dataSource);
        documents = new LocalStateStore(jdbc, json);
        var init = LocalStateStore.class.getDeclaredMethod("init");
        init.setAccessible(true);
        init.invoke(documents);
        scenes = spy(new SqliteProjectSceneRepository(jdbc, json));
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project", "Film", null, null, root.toString(), Instant.now())));
        worktrees = new ProjectWorktreeService(projects, scenes, operations);
        filmRenders = new ProjectFilmRenderService(projects, scenes, new ProjectFilmConfig(json), renderer,
                json, new CreationStateStore(json), new ProjectSourceSnapshots());
        jobs = new SourceRenderJobs(documents, scenes, worktrees, filmRenders, operations, json);
        doAnswer(invocation -> {
            Path output = invocation.getArgument(2);
            Files.createDirectories(output.getParent());
            Files.writeString(output, "rendered video");
            return new ProjectFilmRenderer.Result(output, 60, 960, 540, 30);
        }).when(renderer).render(any(), any(), any());
    }

    @AfterEach void close() { jobs.close(); }

    @Test void lostDatabaseCommitResponseKeepsTheRealVideoAndSnapshot() throws Exception {
        doAnswer(call->{call.callRealMethod();throw new IllegalStateException("commit response lost");})
                .when(scenes).commitWithSnapshot(any(),anyLong(),any(),any(),any(),any(),any(),any(),any());
        var request=request("lost-database-response");
        jobs.submit("project",request);
        var result=await(request.requestId());
        assertEquals("rendered",result.state());
        var version=scenes.findVersion("project",1).orElseThrow();
        assertTrue(Files.isRegularFile(root.resolve(version.artifactPath())));
        assertTrue(Files.isDirectory(root.resolve(version.film().path("sourceSnapshot").asText())));
        assertEquals(1,scenes.listVersions("project").size());
    }

    private SourceRenderRequest request(String id) {
        var state = worktrees.read("project");
        return new SourceRenderRequest(id, state.version(), state.sourceHash(), "明确出片");
    }

    private SourceRenderJobs.Job await(String id) throws Exception {
        return await("project", id);
    }

    private SourceRenderJobs.Job await(String projectId, String id) throws Exception {
        for (int attempt = 0; attempt < 200; attempt++) {
            var job = jobs.get(projectId, id);
            if (!java.util.Set.of("accepted", "running").contains(job.state())) return job;
            Thread.sleep(10);
        }
        throw new AssertionError("render job did not finish");
    }

    private SourceRenderRequest submitProject(String projectId) {
        when(projects.findById(projectId)).thenReturn(Optional.of(new Project(projectId, "Film", null, null, root.toString(), Instant.now())));
        var request = new SourceRenderRequest(projectId, 0L, ProjectSourceFingerprint.compute(root), "出片");
        jobs.submit(projectId, request);
        return request;
    }

    private void occupyWorkers() throws Exception {
        var entered = new CountDownLatch(2);
        doAnswer(invocation -> {
            entered.countDown();
            Thread.sleep(10_000);
            throw new AssertionError("worker was not interrupted");
        }).when(renderer).render(any(), any(), any());
        submitProject("worker-one");
        submitProject("worker-two");
        assertTrue(entered.await(3, TimeUnit.SECONDS));
    }

    @Test void completedRetryDoesNotRequireTheWorkingDirectory() throws Exception {
        var request = request("completed-without-source");
        jobs.submit("project", request);
        var completed = await(request.requestId());
        Files.move(root, temporary.resolve("moved-project"));
        assertEquals("rendered", completed.state());
        assertEquals(completed.result(), jobs.submit("project", request).result());
        verify(renderer, times(1)).render(any(), any(), any());
    }

    @Test void cancellingQueuedJobIsImmediateAndAllowsAnotherRequestForTheProject() throws Exception {
        occupyWorkers();
        var queued = submitProject("queued-project");
        assertEquals("accepted", jobs.get("queued-project", queued.requestId()).state());
        assertEquals("project_busy", assertThrows(ApiException.class, () -> operations.beginDeletion("queued-project")).getCode());
        assertEquals("cancelled", jobs.cancel("queued-project", queued.requestId()).state());
        try (var deletion = operations.beginDeletion("queued-project")) { assertNotNull(deletion); }
        assertEquals("cancelled", jobs.submit("queued-project", queued).state());
        var replacement = new SourceRenderRequest("replacement", 0L, queued.sourceHash(), "重新出片");
        assertEquals("accepted", jobs.submit("queued-project", replacement).state());
        assertFalse(operations.isBusy("queued-project"));
        verify(renderer, times(2)).render(any(), any(), any());
    }

    @Test void cancellingQueuedJobFreesQueueCapacity() throws Exception {
        occupyWorkers();
        for (int index = 0; index < 20; index++) submitProject("queued-" + index);
        jobs.cancel("queued-0", "queued-0");
        var next = submitProject("next-project");
        assertEquals("accepted", jobs.get("next-project", next.requestId()).state());
        verify(renderer, times(2)).render(any(), any(), any());
    }

    @Test void shutdownFinishesQueuedAndRunningJobsWithoutRequiringARestart() throws Exception {
        occupyWorkers();
        var queued = submitProject("queued-project");
        jobs.close();
        assertEquals("interrupted", await("queued-project", queued.requestId()).state());
        assertEquals("interrupted", await("worker-one", "worker-one").state());
        assertEquals("interrupted", await("worker-two", "worker-two").state());
        assertFalse(operations.isBusy("worker-one"));
        assertFalse(operations.isBusy("worker-two"));
        verify(renderer, times(2)).render(any(), any(), any());
    }

    @Test void cancellationStillPreventsCommitWhenRendererConsumesTheInterrupt() throws Exception {
        var entered = new CountDownLatch(1);
        doAnswer(invocation -> {
            entered.countDown();
            try { Thread.sleep(10_000); }
            catch (InterruptedException consumed) { }
            Path output = invocation.getArgument(2);
            Files.createDirectories(output.getParent());
            Files.writeString(output, "late render result");
            return new ProjectFilmRenderer.Result(output, 60, 960, 540, 30);
        }).when(renderer).render(any(), any(), any());
        var request = request("consumed-interrupt");
        jobs.submit("project", request);
        assertTrue(entered.await(3, TimeUnit.SECONDS));
        jobs.cancel("project", request.requestId());
        assertEquals("cancelled", await(request.requestId()).state());
        assertTrue(scenes.listVersions("project").isEmpty());
        try (var files = Files.list(root.resolve("renders"))) { assertEquals(0, files.count()); }
    }

    @Test void exactRetryCreatesOnlyOneVersionAndRemainsReplayableAfterNewEdits() throws Exception {
        var request = request("one");
        jobs.submit("project", request);
        var completed = await("one");
        assertEquals("rendered", completed.state());
        assertEquals(1, completed.result().path("version").asLong());
        assertEquals(request.sourceHash(), completed.result().path("sourceHash").asText());
        assertFalse(worktrees.read("project").dirty());
        Files.writeString(root.resolve("src/index.tsx"), "export const Main = () => <div>Next draft</div>");
        assertEquals(completed.result(), jobs.submit("project", request).result());
        assertTrue(worktrees.read("project").dirty());
        assertEquals(1, scenes.listVersions("project").size());
        verify(renderer, times(1)).render(any(), any(), any());
        assertEquals("task_idempotency_conflict", assertThrows(ApiException.class, () -> jobs.submit("project",
                new SourceRenderRequest("one", request.baseVersion(), request.sourceHash(), "其他请求"))).getCode());
    }

    @Test void staleVersionOrSourceDoesNotStartRenderer() throws Exception {
        var request = request("stale");
        Files.writeString(root.resolve("src/index.tsx"), "modified source");
        assertEquals("source_changed", assertThrows(ApiException.class, () -> jobs.submit("project", request)).getCode());
        var state = worktrees.read("project");
        assertEquals("scene_version_conflict", assertThrows(ApiException.class, () -> jobs.submit("project",
                new SourceRenderRequest("other", 5L, state.sourceHash(), ""))).getCode());
        verifyNoInteractions(renderer);
    }

    @Test void deletionInProgressRejectsRenderBeforePersistingTheRequest() {
        var request = request("during-deletion");
        try (var deletion = operations.beginDeletion("project")) {
            assertEquals("project_deleting", assertThrows(ApiException.class, () -> jobs.submit("project", request)).getCode());
            assertTrue(documents.find("source-render-request", request.requestId()).isEmpty());
            verifyNoInteractions(renderer);
        }
    }

    @Test void editsDuringRenderingStayDirtyAndDoNotChangeTheCapturedFilm() throws Exception {
        var request = request("snapshot");
        var entered = new CountDownLatch(1);
        var finish = new CountDownLatch(1);
        doAnswer(invocation -> {
            Path source = invocation.getArgument(0);
            assertTrue(Files.readString(source.resolve("src/index.tsx")).contains("Original"));
            entered.countDown();
            assertTrue(finish.await(3, TimeUnit.SECONDS));
            assertTrue(Files.readString(source.resolve("src/index.tsx")).contains("Original"));
            Path output = invocation.getArgument(2);
            Files.createDirectories(output.getParent());
            Files.writeString(output, "snapshot video");
            return new ProjectFilmRenderer.Result(output, 60, 960, 540, 30);
        }).when(renderer).render(any(), any(), any());
        try {
            jobs.submit("project", request);
            assertTrue(entered.await(3, TimeUnit.SECONDS));
            Files.writeString(root.resolve("src/index.tsx"), "export const Main = () => <div>Later edit</div>");
            finish.countDown();
            assertEquals("rendered", await("snapshot").state());
            assertTrue(worktrees.read("project").dirty());
            assertEquals(request.sourceHash(), scenes.find("project").orElseThrow().film().path("sourceHash").asText());
        } finally { finish.countDown(); }
    }

    @Test void committedVersionRecoversLostJobReceiptWithoutRenderingAgain() throws Exception {
        var request = request("receipt");
        jobs.submit("project", request);
        var original = await("receipt");
        for (int attempt = 0; attempt < 100 && operations.isBusy("project"); attempt++) Thread.sleep(5);
        jobs.close();
        var saved = documents.find("source-render-request", "receipt").orElseThrow();
        ObjectNode interrupted = saved.data().deepCopy();
        interrupted.put("state", "running").remove("result");
        documents.put(saved.namespace(), saved.id(), saved.projectId(), saved.revision(), interrupted, false);
        jobs = new SourceRenderJobs(documents, scenes, worktrees, filmRenders, operations, json);
        assertEquals(original.result(), jobs.get("project", "receipt").result());
        verify(renderer, times(1)).render(any(), any(), any());
    }

    @Test void renderFailureCleansPartialArtifactsAndKeepsWorktreeAndVersion() throws Exception {
        var request = request("failed");
        doAnswer(invocation -> {
            Path output = invocation.getArgument(2);
            Files.createDirectories(output.getParent());
            Files.writeString(output, "partial");
            throw new ApiException(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY, "render_failed", "编译失败");
        }).when(renderer).render(any(), any(), any());
        jobs.submit("project", request);
        assertEquals("failed", await("failed").state());
        assertEquals(0, worktrees.read("project").version());
        assertEquals(request.sourceHash(), ProjectSourceFingerprint.compute(root));
        try (var files = Files.list(root.resolve("renders"))) { assertEquals(0, files.count()); }
        assertTrue(scenes.listVersions("project").isEmpty());
    }

    @Test void sourceMutationDuringCaptureRejectsAndDiscardsTheMixedSnapshot() throws Exception {
        String hash = ProjectSourceFingerprint.compute(root);
        var snapshots = new ProjectSourceSnapshots() {
            @Override public String capture(Path source) {
                String result = super.capture(source);
                try { Files.writeString(source.resolve("src/index.tsx"), "external edit during capture"); }
                catch (java.io.IOException failure) { throw new RuntimeException(failure); }
                return result;
            }
        };
        assertEquals("source_changed", assertThrows(ApiException.class, () -> snapshots.captureVerified(root, hash)).getCode());
        try (var files = Files.list(root.resolve(".fengmotion/source-snapshots"))) { assertEquals(0, files.count()); }
        assertEquals("external edit during capture", Files.readString(root.resolve("src/index.tsx")));
    }

    @Test void cancellationInterruptsOnlyTheRenderAndDoesNotCommitAVersion() throws Exception {
        var request = request("cancel-render");
        var entered = new CountDownLatch(1);
        doAnswer(invocation -> {
            entered.countDown();
            Thread.sleep(10_000);
            throw new AssertionError("cancel did not interrupt renderer");
        }).when(renderer).render(any(), any(), any());
        jobs.submit("project", request);
        assertTrue(entered.await(3, TimeUnit.SECONDS));
        jobs.cancel("project", request.requestId());
        assertEquals("cancelled", await(request.requestId()).state());
        assertEquals(0, worktrees.read("project").version());
        assertEquals(request.sourceHash(), ProjectSourceFingerprint.compute(root));
        assertEquals("cancelled", jobs.submit("project", request).state());
        verify(renderer, times(1)).render(any(), any(), any());
    }

    @Test void abandonedUncommittedRequestBecomesInterruptedInsteadOfRenderingAgain() throws Exception {
        var request = request("interrupted");
        var data = json.createObjectNode().put("state", "running").put("createdAt", Instant.now().toString());
        data.set("request", json.valueToTree(request));
        documents.put("source-render-request", request.requestId(), "project", 0, data, false);
        assertEquals("interrupted", jobs.get("project", request.requestId()).state());
        assertEquals("interrupted", jobs.submit("project", request).state());
        assertEquals("not_found", assertThrows(ApiException.class, () -> jobs.get("another-project", request.requestId())).getCode());
        verifyNoInteractions(renderer);
    }
}
