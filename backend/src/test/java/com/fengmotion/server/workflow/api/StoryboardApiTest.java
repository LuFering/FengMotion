package com.fengmotion.server.workflow.api;

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
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class StoryboardApiTest {
    @TempDir Path root;
    @Autowired MockMvc mvc;
    @Autowired ProjectRepository projects;

    @Test void planningEndpointIsReadOnlyAndPreservesSourceIdentity() throws Exception {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "storyboard", null, null, root.toString(), Instant.now()));
        mvc.perform(get("/api/projects/{id}/storyboard", id)).andExpect(status().isOk())
                .andExpect(header().string("X-Storyboard-Source", "none")).andExpect(content().json("[]"));
        Files.writeString(root.resolve("storyboard.json"), "{\"schemaVersion\":\"1.0\",\"type\":\"storyboard\",\"entries\":[{\"id\":\"scene-1\",\"narration\":\"原文\"}]}");
        mvc.perform(get("/api/projects/{id}/storyboard", id)).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store")).andExpect(header().exists("ETag"))
                .andExpect(header().string("X-Storyboard-Source", "storyboard.json"))
                .andExpect(jsonPath("$[0].projectId").value(id)).andExpect(jsonPath("$[0].narration").value("原文"));
        mvc.perform(get("/api/projects/missing/storyboard")).andExpect(status().isNotFound());
    }
}
