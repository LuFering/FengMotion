package com.fengmotion.server.creation.api;

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

/**
 * {@code GET /api/projects/{id}/content-counts} 的行为契约。
 *
 * <p>只验证「数量与既有读模型一致」——不重复 timeline/storyboard/scene
 * 各自的边界校验，那些用例留在原有 API 测试里。本接口的核心承诺是：
 * 不猜测、不发明数据，来源缺失时返回 0。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ProjectContentCountsApiTest {
    @TempDir Path root;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired ProjectRepository projects;
    @Autowired ProjectSceneRepository versions;

    private String project() {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "content-counts", null, null, root.toString(), Instant.now()));
        return id;
    }

    private void renderedWithTimeline(String id) throws Exception {
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

    private void storyboard(int count) throws Exception {
        var items = new StringBuilder();
        for (int i = 0; i < count; i++) {
            if (i > 0) items.append(",");
            items.append("{\"id\":\"seg-").append(i).append("\",\"segment\":\"第").append(i).append("段\"}");
        }
        Files.writeString(root.resolve("storyboard.json"),
                "{\"schemaVersion\":\"1.0\",\"type\":\"storyboard\",\"entries\":[" + items + "]}");
    }

    @Test void renderedProjectWithStoryboardReportsRealCounts() throws Exception {
        String id = project();
        renderedWithTimeline(id);
        storyboard(3);
        mvc.perform(get("/api/projects/{id}/content-counts", id))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.projectId").value(id))
                .andExpect(jsonPath("$.scenes").value(2))
                .andExpect(jsonPath("$.compositions").value(1))
                .andExpect(jsonPath("$.timelineClips").value(3))
                .andExpect(jsonPath("$.storyboardSegments").value(3))
                .andExpect(jsonPath("$.doneScenes").value(0));
    }

    @Test void emptyProjectReportsZeroEverywhereAndDoesNotLeakAcrossProjects() throws Exception {
        String id = project();
        mvc.perform(get("/api/projects/{id}/content-counts", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scenes").value(0))
                .andExpect(jsonPath("$.timelineClips").value(0))
                .andExpect(jsonPath("$.storyboardSegments").value(0))
                .andExpect(jsonPath("$.compositions").value(0));
        renderedWithTimeline(id);
        storyboard(2);
        String other = project();
        mvc.perform(get("/api/projects/{id}/content-counts", other))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scenes").value(0))
                .andExpect(jsonPath("$.timelineClips").value(0));
        mvc.perform(get("/api/projects/unknown/content-counts")).andExpect(status().isNotFound());
    }

    @Test void renderedProjectWithoutTimelineOrStoryboardReportsZeroNotError() throws Exception {
        String id = project();
        Path video = Files.writeString(root.resolve("video.mp4"), "video-content");
        var film = json.readTree("""
                {"kind":"project-render","sourceHash":"s","compositionId":"Main",
                 "output":{"width":640,"height":360,"fps":30,"durationInFrames":60},
                 "shotTimeline":{"shots":[{"id":"a"}]}}
                """);
        versions.commitWithSnapshot(id, 0, film, null, "", "", "video.mp4", "task", null);
        mvc.perform(get("/api/projects/{id}/content-counts", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scenes").value(1))
                .andExpect(jsonPath("$.timelineClips").value(0))
                .andExpect(jsonPath("$.storyboardSegments").value(0))
                .andExpect(jsonPath("$.compositions").value(1));
    }

    @Test void corruptStoryboardCountsAsZeroNotError() throws Exception {
        String id = project();
        renderedWithTimeline(id);
        Files.writeString(root.resolve("storyboard.json"), "{not-json");
        mvc.perform(get("/api/projects/{id}/content-counts", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.storyboardSegments").value(0));
    }

    @Test void shotPlanFileAlsoCountsSegments() throws Exception {
        String id = project();
        renderedWithTimeline(id);
        Files.writeString(root.resolve("shot-plan.json"), """
                {"schemaVersion":"1.0","type":"shot-plan","fps":30,"durationInFrames":90,
                 "shots":[{"id":"SH01","from":0,"durationInFrames":90,"eventIds":[],"captionIds":[]}],
                 "captions":[],"events":[]}
                """);
        mvc.perform(get("/api/projects/{id}/content-counts", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.storyboardSegments").value(1));
    }
}
