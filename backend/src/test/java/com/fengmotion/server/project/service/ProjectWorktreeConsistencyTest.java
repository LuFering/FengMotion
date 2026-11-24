package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.*;
import com.fengmotion.server.project.store.*;

class ProjectWorktreeConsistencyTest {
    @TempDir Path root;

    @Test void versionChangeDuringFingerprintingCannotReturnMixedState() throws Exception {
        Files.writeString(root.resolve("index.tsx"), "source");
        var projects = mock(ProjectRepository.class);
        var scenes = mock(ProjectSceneRepository.class);
        var operations = new ProjectOperationLock();
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project", "test", null, null, root.toString(), Instant.now())));
        var film = new ObjectMapper().createObjectNode().put("sourceHash", ProjectSourceFingerprint.compute(root));
        when(scenes.find("project")).thenReturn(Optional.of(new ProjectScene("project", 1, film, null, Instant.now())),
                Optional.of(new ProjectScene("project", 2, film, null, Instant.now())));
        var service = new ProjectWorktreeService(projects, scenes, operations);
        assertEquals("scene_version_conflict", assertThrows(ApiException.class, () -> service.read("project")).getCode());
        try (var deletion = operations.beginDeletion("project")) { assertNotNull(deletion); }
    }
}
