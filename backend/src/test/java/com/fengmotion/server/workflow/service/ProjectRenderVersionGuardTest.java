package com.fengmotion.server.workflow.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

class ProjectRenderVersionGuardTest {
    @Test void rejectsStaleTargetBeforeAgentOrProjectMutationAndReleasesLock() {
        var scenes = mock(ProjectSceneRepository.class);
        var projects = mock(ProjectRepository.class);
        var agent = mock(CreateAgentRunner.class);
        var workflow = mock(WorkflowProjectService.class);
        var lock = new ProjectOperationLock();
        var json = new ObjectMapper();
        when(scenes.find("project")).thenReturn(Optional.of(new ProjectScene("project", 4, json.createObjectNode(), null, Instant.now())));
        var service = new ProjectRenderService(projects, scenes, mock(ProjectFilmConfig.class),
                mock(ProjectFilmRenderer.class), agent, mock(ResourceContextBuilder.class), json,
                mock(CreationStateStore.class), lock, mock(ProjectSourceSnapshots.class), workflow);

        ApiException error = assertThrows(ApiException.class,
                () -> service.createThenRender("project", "修改", null, null, 3L, "不应保存的旧版本意见"));
        assertEquals("version_conflict", error.getCode());
        assertFalse(lock.isBusy("project"));
        verifyNoInteractions(projects, agent, workflow);
    }

    @Test void rejectsInvalidImageBeforeRecordingCorrection() {
        var scenes = mock(ProjectSceneRepository.class);
        var workflow = mock(WorkflowProjectService.class);
        var lock = new ProjectOperationLock();
        var json = new ObjectMapper();
        when(scenes.find("project")).thenReturn(Optional.of(new ProjectScene("project", 4, json.createObjectNode(), null, Instant.now())));
        var service = new ProjectRenderService(mock(ProjectRepository.class), scenes, mock(ProjectFilmConfig.class),
                mock(ProjectFilmRenderer.class), mock(CreateAgentRunner.class), mock(ResourceContextBuilder.class), json,
                mock(CreationStateStore.class), lock, mock(ProjectSourceSnapshots.class), workflow);

        assertThrows(ApiException.class, () -> service.createThenRender("project", "修改", null, "invalid", 4L, "意见"));
        verifyNoInteractions(workflow);
        assertFalse(lock.isBusy("project"));
    }
}
