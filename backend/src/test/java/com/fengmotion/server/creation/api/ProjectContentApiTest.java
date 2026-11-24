package com.fengmotion.server.creation.api;

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
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.VideoTimeline;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ProjectContentApiTest {
    @TempDir Path root;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired ProjectRepository projects;
    @Autowired ProjectSceneRepository versions;
    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;

    private String project() {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "content", null, null, root.toString(), Instant.now()));
        return id;
    }

    private void rendered(String id) throws Exception {
        Path video = Files.writeString(root.resolve("video.mp4"), "video-content");
        var film = json.readTree("""
                {"kind":"project-render","sourceHash":"source-one","compositionId":"Main",
                 "output":{"width":640,"height":360,"fps":30,"durationInFrames":60},
                 "shotTimeline":{"shots":[{"id":"intro"},{"id":"outro"}]}}
                """);
        var manifest = json.readTree("""
                {"schemaVersion":2,"fps":30,"durationSeconds":2,"origin":"shot-assembly","detail":"sequences",
                 "tracks":[{"id":"shots","name":"镜头","clips":[
                   {"id":"intro","name":"Intro","kind":"video","start":0,"duration":1},
                   {"id":"outro","name":"Outro","kind":"video","start":1,"duration":1}]},
                   {"id":"audio","name":"配音","clips":[{"id":"intro","name":"Narration","kind":"audio","start":0,"duration":2}]}]}
                """);
        VideoTimeline.write(json, video, "video.mp4", manifest, 60, 30, "source-one", false);
        versions.commitWithSnapshot(id, 0, film, null, "", "", "video.mp4", "task", null);
    }

    @Test void currentTimelineScenesAndPathManifestCoexistWithoutFabricatingReviewApproval() throws Exception {
        String id = project();
        rendered(id);
        String body = mvc.perform(get("/api/projects/{id}/timeline", id)).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.durationMs").value(2000)).andExpect(jsonPath("$.width").value(640))
                .andExpect(jsonPath("$.clips.length()").value(3)).andExpect(jsonPath("$.clips[0].sceneId").value("intro"))
                .andReturn().getResponse().getContentAsString();
        var clips = json.readTree(body).path("clips");
        assertNotEquals(clips.get(0).path("id").asText(), clips.get(1).path("id").asText());
        assertTrue(clips.get(1).path("sceneId").isNull());
        mvc.perform(get("/api/projects/{id}/timeline", id).param("path", "video.mp4"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.schemaVersion").value(2));
        mvc.perform(get("/api/projects/{id}/scenes", id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2)).andExpect(jsonPath("$[1].id").value("outro"))
                .andExpect(jsonPath("$[1].startMs").value(1000)).andExpect(jsonPath("$[1].status").value("idle"))
                .andExpect(jsonPath("$[1].timingKnown").value(true));
        mvc.perform(get("/api/projects/{id}/scenes/outro", id)).andExpect(status().isOk()).andExpect(jsonPath("$.index").value(2));
        mvc.perform(get("/api/projects/{id}/scenes/missing", id)).andExpect(status().isNotFound());
    }

    @Test void missingAndChangedVideoDoNotProduceInventedCurrentContent() throws Exception {
        String id = project();
        rendered(id);
        Files.delete(VideoTimeline.manifestPath(root.resolve("video.mp4")));
        mvc.perform(get("/api/projects/{id}/timeline", id)).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("timeline_missing"));
        VideoTimeline.write(json, root.resolve("video.mp4"), "video.mp4", VideoTimeline.composition(json, 60, 30, "Main", "composition"), 60, 30, "source-one", false);
        Files.writeString(root.resolve("video.mp4"), "replaced");
        mvc.perform(get("/api/projects/{id}/scenes", id)).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("timeline_video_changed"));
    }

    @Test void anEmptyProjectIsEmptyAndAnotherProjectsScenesCannotBeSelected() throws Exception {
        String id = project();
        mvc.perform(get("/api/projects/{id}/timeline", id)).andExpect(status().isOk()).andExpect(jsonPath("$.durationMs").value(0));
        mvc.perform(get("/api/projects/{id}/scenes", id)).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(get("/api/projects/{id}/scenes/intro", id)).andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/unknown/scenes")).andExpect(status().isNotFound());
        rendered(id);
        String other = project();
        mvc.perform(get("/api/projects/{id}/scenes/intro", other)).andExpect(status().isNotFound());
    }

    @Test void corruptCurrentVersionDoesNotAppearAsAnEmptyProject() throws Exception {
        String id = project();
        rendered(id);
        jdbc.update("UPDATE project_scenes SET film_json='broken-json' WHERE project_id=?", id);
        mvc.perform(get("/api/projects/{id}/scenes", id)).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("project_content_unavailable"));
        for (String endpoint : java.util.List.of("scene", "source/state")) {
            mvc.perform(get("/api/projects/{id}/" + endpoint, id)).andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.error.code").value("scene_corrupt"));
        }
    }
}
