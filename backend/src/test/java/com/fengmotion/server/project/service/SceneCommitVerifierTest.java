package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.store.ProjectSceneRepository;

class SceneCommitVerifierTest {
    @Test void historyCollisionIsNeverTreatedAsALostAcknowledgement() {
        var scenes = mock(ProjectSceneRepository.class);
        var film = new ObjectMapper().createObjectNode().put("sourceHash", "hash");
        var failure = new ApiException(org.springframework.http.HttpStatus.CONFLICT, "scene_history_conflict", "collision");
        assertSame(failure, assertThrows(ApiException.class, () -> SceneCommitVerifier.commit(scenes, "project", 1,
                film, "renders/new.mp4", () -> { throw failure; })));
        verifyNoInteractions(scenes);
    }
    @Test void confirmsCommittedVersionWhenWriteResponseWasLost() {
        var scenes=mock(ProjectSceneRepository.class);
        var film=new ObjectMapper().createObjectNode().put("sourceHash","hash");
        when(scenes.findVersion("project",2)).thenReturn(Optional.of(new ProjectSceneVersion("project",2,film,null,"","","renders/new.mp4","task",null,Instant.now())));
        assertEquals(Optional.of(2L),SceneCommitVerifier.commit(scenes,"project",1,film,"renders/new.mp4",()->{throw new IllegalStateException("lost acknowledgement");}));
    }
    @Test void differentVersionIsNotMistakenForThisCommitAndUnknownOutcomeRetainsEvidence() {
        var scenes=mock(ProjectSceneRepository.class);
        var film=new ObjectMapper().createObjectNode().put("sourceHash","hash");
        assertThrows(IllegalStateException.class,()->SceneCommitVerifier.commit(scenes,"project",1,film,"renders/new.mp4",()->{throw new IllegalStateException("failed commit");}));
        when(scenes.findVersion("project",2)).thenThrow(new IllegalStateException("database offline"));
        var error=assertThrows(ApiException.class,()->SceneCommitVerifier.commit(scenes,"project",1,film,"renders/new.mp4",()->{throw new IllegalStateException("unknown commit");}));
        assertTrue(SceneCommitVerifier.uncertain(error));
    }
}
