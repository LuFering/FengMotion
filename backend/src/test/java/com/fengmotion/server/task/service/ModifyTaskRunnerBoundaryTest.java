package com.fengmotion.server.task.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.*;
import com.fengmotion.server.project.store.*;
import com.fengmotion.server.render.service.RemotionRenderer;
import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.store.TaskRepository;

class ModifyTaskRunnerBoundaryTest {
    @TempDir Path root;
    private final ObjectMapper json = new ObjectMapper();
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final ProjectSceneRepository scenes = mock(ProjectSceneRepository.class);
    private final RemotionRenderer renderer = mock(RemotionRenderer.class);
    private final ModelModifyPlanner planner = mock(ModelModifyPlanner.class);
    private final TaskRepository tasks = mock(TaskRepository.class);
    private final TaskService taskService = mock(TaskService.class);

    private ModifyTaskRunner runner() throws Exception {
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project", "test", null, null, root.toString(), Instant.now())));
        var film = json.readTree("{\"fps\":30,\"scenes\":[{\"id\":\"one\",\"text\":\"old\",\"durationSeconds\":2}]}");
        when(scenes.find("project")).thenReturn(Optional.of(new ProjectScene("project", 2, film, null, Instant.now())));
        when(planner.plan(any(), any(), any())).thenReturn(new ModifyPlan(List.of(new ModifyPlan.Edit("one", "text", "old", "new", "edit"))));
        when(renderer.render(any(), any(), any())).thenAnswer(call -> {
            Path output = call.getArgument(1);
            Files.createDirectories(output.getParent());
            Files.writeString(output, "rendered");
            return new RemotionRenderer.RenderResult(output.toString(), 60, 640, 360, 30);
        });
        return new ModifyTaskRunner(renderer, planner, new ModifyPlanApplier(json), projects, scenes, tasks, taskService, json);
    }

    private Task task(long version) {
        return new Task("task", "project", "modify", "queued", "edit",
                json.createObjectNode().put("scope", "project").put("baseVersion", version),
                0, "", null, null, Instant.now(), Instant.now(), null, null, null);
    }

    @Test void queuedStaleTaskIsRejectedBeforeCallingTheModel() throws Exception {
        var runner = runner();
        assertEquals("scene_version_conflict", assertThrows(ApiException.class,
                () -> runner.run(task(1), mock(TaskService.Progress.class))).getCode());
        verifyNoInteractions(planner, renderer);
    }

    @Test void corruptCurrentSceneCannotFallBackToRequestData() throws Exception {
        var runner = runner();
        when(scenes.find("project")).thenReturn(Optional.of(new ProjectScene("project", 2, null, null, Instant.now())));
        assertEquals("scene_corrupt", assertThrows(ApiException.class,
                () -> runner.run(task(2), mock(TaskService.Progress.class))).getCode());
        verifyNoInteractions(planner, renderer);
    }

    @Test void cancellationAtCommitProgressCannotRegisterANewVersion() throws Exception {
        var runner = runner();
        var cancelled = new java.util.concurrent.atomic.AtomicBoolean();
        var progress = new TaskService.Progress() {
            @Override public boolean isCancelled() { return cancelled.get(); }
            @Override public void report(int percent, String message) { if (percent == 90) cancelled.set(true); }
        };
        assertNull(runner.run(task(2), progress));
        verify(scenes, never()).commitWithSnapshot(any(), anyLong(), any(), any(), any(), any(), any(), any(), any());
        try (var files = Files.list(root.resolve("renders"))) { assertEquals(0, files.count()); }
    }

    @Test void legacyRenderAndModifyRejectLinkedOutputDirectory() throws Exception {
        var runner = runner();
        Path outside = Files.createDirectory(root.resolve("outside"));
        Files.createSymbolicLink(root.resolve("renders"), outside);
        assertEquals("render_path_invalid", assertThrows(ApiException.class,
                () -> runner.run(task(2), mock(TaskService.Progress.class))).getCode());
        var renderTask = new Task("task", "project", "render", "queued", "", json.createObjectNode()
                .set("film", json.readTree("{\"scenes\":[{}]}")), 0, "", null, null, Instant.now(), Instant.now(), null, null, null);
        assertEquals("render_path_invalid", assertThrows(ApiException.class,
                () -> new RenderTaskRunner(renderer, projects).run(renderTask, mock(TaskService.Progress.class))).getCode());
        verifyNoInteractions(renderer);
        try (var files = Files.list(outside)) { assertEquals(0, files.count()); }
    }

    @Test void committedSceneRemainsSuccessfulWhenAuxiliaryTaskVersionWriteFails() throws Exception {
        var runner = runner();
        when(scenes.commitWithSnapshot(any(), anyLong(), any(), any(), any(), any(), any(), any(), any())).thenReturn(Optional.of(3L));
        doThrow(new IllegalStateException("receipt failed")).when(tasks).updateVersions("task", 2L, 3L);
        String artifact = runner.run(task(2), mock(TaskService.Progress.class));
        assertTrue(Files.isRegularFile(root.resolve(artifact)));
        verify(taskService).registerArtifact("task", artifact);
    }
}
