package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.creation.domain.CreateRequest;
import com.fengmotion.server.creation.domain.CreationSessionAccess;
import com.fengmotion.server.creation.store.CreationTaskStore;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.store.CreationStateStore;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.workflow.service.WorkflowProjectService;

class ProjectDraftCreationTest {
    @TempDir Path root;

    @Test void draftEditKeepsSourcesAndReplyWithoutCallingRendererOrRegisteringVersion() throws Exception {
        var projects = mock(ProjectRepository.class);
        var scenes = mock(ProjectSceneRepository.class);
        var agent = mock(CreateAgentRunner.class);
        var resources = mock(ResourceContextBuilder.class);
        var tasks = mock(CreationTaskStore.class);
        var renders = mock(ProjectFilmRenderService.class);
        var sessions = mock(CreationSessionAccess.class);
        var operations = new ProjectOperationLock();
        var states = new CreationStateStore(new ObjectMapper());
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project", "Draft", null, null, root.toString(), Instant.now())));
        when(resources.build(any())).thenReturn(ResourceContextBuilder.ResourceContext.EMPTY);
        when(agent.run(any(Path.class), any(), any(), isNull(), eq("project"), isNull(), eq("draft-request"), isNull()))
                .thenAnswer(invocation -> {
                    assertTrue(((String) invocation.getArgument(1)).contains("仅修改工作稿"));
                    Path candidate = invocation.getArgument(0);
                    assertNotEquals(root, candidate);
                    assertFalse(Files.exists(root.resolve("src/index.tsx")));
                    Files.createDirectories(candidate.resolve("src"));
                    Files.writeString(candidate.resolve("src/index.tsx"), "export const Title = () => <div>Updated title</div>;");
                    return new CreateAgentRunner.AgentOutcome("标题已改短", 3, true, true, true, "before", "after");
                });
        var service = new ProjectCreationService(projects, scenes, agent, resources, states, tasks,
                sessions, operations, renders, mock(WorkflowProjectService.class));
        var request = new CreateRequest("标题改短", null, null, null, null, "draft-request", null, null,
                null, null, null, null, null, "draft");
        var result = service.createDraft("project", request);
        assertEquals("edited", result.state());
        assertNull(result.version());
        assertNull(result.artifactPath());
        assertTrue(Files.readString(root.resolve("src/index.tsx")).contains("Updated title"));
        assertEquals("edited", states.read(root).state());
        verify(tasks).updateCompleted("draft-request", "edited", "edited", "标题已改短", null, null, false);
        verifyNoInteractions(renders);
        verify(scenes).find("project");
        verify(scenes, never()).commitWithSnapshot(any(), anyLong(), any(), any(), any(), any(), any(), any(), any());
        assertFalse(operations.isBusy("project"));
    }
}
