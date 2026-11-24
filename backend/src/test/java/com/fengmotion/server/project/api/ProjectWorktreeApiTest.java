package com.fengmotion.server.project.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.ProjectSourceFingerprint;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ProjectWorktreeApiTest {
    @TempDir Path root;
    @Autowired MockMvc mvc;
    @Autowired ProjectRepository projects;
    @Autowired ProjectSceneRepository scenes;
    @Autowired ObjectMapper json;
    @Autowired com.fengmotion.server.project.service.ProjectOperationLock operations;

    @Test void deletingProjectCannotBeReadAsAnEmptyWorkingTree() throws Exception {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "Deleting", null, null, root.toString(), Instant.now()));
        try (var deletion = operations.beginDeletion(id)) {
            mvc.perform(get("/api/projects/{id}/source/state", id)).andExpect(status().isConflict())
                    .andExpect(jsonPath("$.error.code").value("project_deleting"));
        }
    }

    @Test void dirtySurvivesReopeningAndBecomesCleanOnlyForMatchingRenderedSources() throws Exception {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "Working copy", null, null, root.toString(), Instant.now()));
        Files.createDirectories(root.resolve("src"));
        Path file = root.resolve("src/Title.tsx");
        Files.writeString(file, "export const Title = () => <div>Original</div>");
        String originalHash = ProjectSourceFingerprint.compute(root);
        var film = json.createObjectNode().put("kind", "project-render").put("sourceHash", originalHash);
        scenes.commitWithSnapshot(id, 0, film, null, "", "", "renders/v1.mp4", "task", null).orElseThrow();
        String path = "/api/projects/" + id + "/source/state";
        mvc.perform(get(path)).andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.dirty").value(false)).andExpect(jsonPath("$.status").value("clean"));
        Files.writeString(file, "export const Title = () => <div>Unrendered</div>");
        for (int count = 0; count < 2; count++) mvc.perform(get(path)).andExpect(jsonPath("$.dirty").value(true))
                .andExpect(jsonPath("$.version").value(1)).andExpect(jsonPath("$.renderedSourceHash").value(originalHash));
        Files.writeString(file, "export const Title = () => <div>Original</div>");
        mvc.perform(get(path)).andExpect(jsonPath("$.dirty").value(false));
        assertEquals(1, scenes.listVersions(id).size());
        assertFalse(Files.exists(root.resolve(".fengmotion")));
    }

    @Test void newAndLegacyProjectsAreNotMistakenForMatchingRenderedSources() throws Exception {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "New", null, null, root.toString(), Instant.now()));
        mvc.perform(get("/api/projects/{id}/source/state", id)).andExpect(jsonPath("$.status").value("unrendered"))
                .andExpect(jsonPath("$.version").value(0));
        scenes.commitWithSnapshot(id, 0, json.createObjectNode(), null, "", "", null, "task", null);
        mvc.perform(get("/api/projects/{id}/source/state", id)).andExpect(jsonPath("$.status").value("unknown"))
                .andExpect(jsonPath("$.dirty").isEmpty());
        mvc.perform(get("/api/projects/missing/source/state")).andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control", "no-store"));
        for (String endpoint : java.util.List.of("render-jobs", "creation-jobs", "workbench-jobs", "tasks")) {
            mvc.perform(get("/api/projects/missing/" + endpoint)).andExpect(status().isNotFound());
        }
    }
}
