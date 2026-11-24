package com.fengmotion.server.creation.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
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
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.VideoTimeline;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class VersionReviewApiTest {
    @TempDir Path root;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired ProjectRepository projects;
    @Autowired ProjectSceneRepository scenes;

    @Test void explicitVersionReviewCannotBeForgedThroughGenericDocuments() throws Exception {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "review", null, null, root.toString(), Instant.now()));
        Path video = Files.writeString(root.resolve("film.mp4"), "video");
        scenes.commitWithSnapshot(id, 0, json.createObjectNode(), null, "", "", "film.mp4", "task", null);
        String route = "/api/projects/" + id + "/scene/versions/1/reviews";
        mvc.perform(get(route)).andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.state").value("unreviewed"));
        String body = json.createObjectNode().put("requestId", "reject-one").put("expectedRevision", 0)
                .put("decision", "rejected").put("note", "需要修改").put("videoHash", VideoTimeline.videoHash(video)).toString();
        mvc.perform(post(route).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk())
                .andExpect(jsonPath("$.recordedVia").value("local-review-api"));
        mvc.perform(post(route).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk());
        mvc.perform(get(route)).andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(1))
                .andExpect(jsonPath("$.history.length()").value(1)).andExpect(jsonPath("$.state").value("rejected"));
        mvc.perform(put("/api/local-documents/version-review/" + id + ":1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedRevision\":1,\"data\":{\"decision\":\"approved\"}}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/local-documents/page").param("namespace", "version-review"))
                .andExpect(status().isBadRequest());
        Files.writeString(video, "changed");
        mvc.perform(get(route)).andExpect(status().isOk()).andExpect(jsonPath("$.state").value("stale"));
    }
}
