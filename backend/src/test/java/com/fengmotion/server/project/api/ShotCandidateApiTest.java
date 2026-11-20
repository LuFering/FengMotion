package com.fengmotion.server.project.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.domain.ShotTimeline;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.service.ProjectSourceFingerprint;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.ProjectFilmRenderer;
import com.fengmotion.server.render.service.VideoTimeline;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ShotCandidateApiTest {
    private static final String PREVIEW = "/api/projects/{id}/scene/versions/{version}/shot-candidates";
    private static final String COMPONENT = "export const Shot = () => <div>Candidate chart</div>;";

    @TempDir Path workspace;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired ProjectRepository projects;
    @Autowired ProjectSceneRepository scenes;
    @Autowired ProjectSourceSnapshots snapshots;
    @Autowired ProjectOperationLock operations;
    @MockBean ProjectFilmRenderer renderer;

    @Test
    void previewsInIsolationAndCommitsOnlyAfterExplicitConfirmation() throws Exception {
        Project project = newShotProject();
        ObjectNode film = saveVersion(project, 0);
        Path root = Path.of(project.rootPath());
        String originalHash = ProjectSourceFingerprint.compute(root);
        String candidateId = UUID.randomUUID().toString();
        mockSuccessfulRender();
        String requestBody = request(film.path("sourceHash").asText(), "chart", candidateId, COMPONENT);

        var response = mvc.perform(post(PREVIEW, project.id(), 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.candidateId").value(candidateId))
                .andExpect(jsonPath("$.baseVersion").value(1))
                .andExpect(jsonPath("$.shotId").value("chart"))
                .andExpect(jsonPath("$.sourceId").value("fm-candidate-" + candidateId.replace("-", "")))
                .andExpect(jsonPath("$.durationInFrames").value(60))
                .andExpect(jsonPath("$.hasVoiceover").value(false))
                .andReturn();

        mvc.perform(post(PREVIEW, project.id(), 1).contentType(MediaType.APPLICATION_JSON).content(requestBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.candidateId").value(candidateId));
        verify(renderer, org.mockito.Mockito.times(1)).render(any(), any(), any());

        assertEquals(originalHash, ProjectSourceFingerprint.compute(root));
        assertEquals(1, scenes.listVersions(project.id()).size());
        assertFalse(Files.exists(root.resolve("src/shots/fm-candidate-" + candidateId.replace("-", "") + ".tsx")));
        String previewUrl = json.readTree(response.getResponse().getContentAsString()).path("previewUrl").asText();
        mvc.perform(get(previewUrl))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Content-Type", "video/mp4"));

        mvc.perform(post(PREVIEW + "/{candidateId}/commit", project.id(), 1, candidateId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.candidateId").value(candidateId))
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.shotId").value("chart"))
                .andExpect(jsonPath("$.durationInFrames").value(90));

        var committed = scenes.findVersion(project.id(), 2).orElseThrow();
        assertEquals(ProjectSceneVersion.SOURCE_SHOT_EDIT, committed.source());
        assertEquals(candidateId, committed.film().path("shotEdit").path("candidateId").asText());
        assertFalse(originalHash.equals(ProjectSourceFingerprint.compute(root)));
        assertEquals(committed.film().path("sourceHash").asText(), ProjectSourceFingerprint.compute(root));
        assertTrue(Files.isRegularFile(root.resolve("src/shots/fm-candidate-" + candidateId.replace("-", "") + ".tsx")));
        String nextConfig = Files.readString(root.resolve("film.config.json"));
        assertTrue(nextConfig.contains("fm-candidate-" + candidateId.replace("-", "")));
        assertTrue(nextConfig.contains("\"sourceId\":\"outro\""));
        assertEquals(2, scenes.listVersions(project.id()).size());

        mvc.perform(post(PREVIEW + "/{candidateId}/commit", project.id(), 1, candidateId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2));
        mvc.perform(delete(PREVIEW + "/{candidateId}", project.id(), 1, candidateId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("shot_candidate_already_committed"));
        assertEquals(2, scenes.listVersions(project.id()).size());
        assertFalse(operations.isBusy(project.id()));
    }

    @Test
    void rejectsStaleBaselineAndDoesNotRender() throws Exception {
        Project project = newShotProject();
        ObjectNode first = saveVersion(project, 0);
        saveVersion(project, 1);

        mvc.perform(post(PREVIEW, project.id(), 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(first.path("sourceHash").asText(), "chart", UUID.randomUUID().toString(), COMPONENT)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("scene_version_conflict"));

        verify(renderer, never()).render(any(), any(), any());
    }

    @Test
    void failedPreviewLeavesNoCandidateOrVersionAndKeepsWorkingTreeUntouched() throws Exception {
        Project project = newShotProject();
        ObjectNode film = saveVersion(project, 0);
        Path root = Path.of(project.rootPath());
        String originalHash = ProjectSourceFingerprint.compute(root);
        String candidateId = UUID.randomUUID().toString();
        when(renderer.render(any(), any(), any())).thenAnswer(invocation -> {
            Path output = invocation.getArgument(2);
            Files.createDirectories(output.getParent());
            Files.writeString(output, "partial");
            throw new com.fengmotion.server.common.ApiException(org.springframework.http.HttpStatus.BAD_GATEWAY,
                    "render_failed", "渲染失败");
        });

        mvc.perform(post(PREVIEW, project.id(), 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(film.path("sourceHash").asText(), "chart", candidateId, COMPONENT)))
                .andExpect(status().isBadGateway());

        assertEquals(originalHash, ProjectSourceFingerprint.compute(root));
        assertEquals(1, scenes.listVersions(project.id()).size());
        assertFalse(Files.exists(root.resolve(".fengmotion/shot-candidates/" + candidateId)));
        assertFalse(operations.isBusy(project.id()));
    }

    @Test
    void failedFullRenderAfterPreviewKeepsCandidateRetryableAndDoesNotChangeVersion() throws Exception {
        Project project = newShotProject();
        ObjectNode film = saveVersion(project, 0);
        Path root = Path.of(project.rootPath());
        String originalHash = ProjectSourceFingerprint.compute(root);
        String candidateId = UUID.randomUUID().toString();
        AtomicInteger calls = new AtomicInteger();
        when(renderer.render(any(), any(), any())).thenAnswer(invocation -> {
            if (calls.incrementAndGet() == 1) return renderTo(invocation.getArgument(2), 60, 960, 540, 30);
            Path output = invocation.getArgument(2);
            Files.createDirectories(output.getParent());
            Files.writeString(output, "partial-final");
            throw new com.fengmotion.server.common.ApiException(org.springframework.http.HttpStatus.BAD_GATEWAY,
                    "render_failed", "全片渲染失败");
        });
        mvc.perform(post(PREVIEW, project.id(), 1).contentType(MediaType.APPLICATION_JSON)
                        .content(request(film.path("sourceHash").asText(), "chart", candidateId, COMPONENT)))
                .andExpect(status().isOk());

        mvc.perform(post(PREVIEW + "/{candidateId}/commit", project.id(), 1, candidateId))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("render_failed"));

        assertEquals(originalHash, ProjectSourceFingerprint.compute(root));
        assertEquals(1, scenes.listVersions(project.id()).size());
        assertTrue(Files.isRegularFile(root.resolve(".fengmotion/shot-candidates/" + candidateId + "/preview.mp4")));
        assertFalse(Files.exists(root.resolve("renders/project-shot-" + candidateId + ".mp4")));
    }

    @Test
    void commitConflictRollsBackWorkingSourceAndDiscardsFinalArtifact() throws Exception {
        Project project = newShotProject();
        ObjectNode baseFilm = saveVersion(project, 0);
        Path root = Path.of(project.rootPath());
        String originalHash = ProjectSourceFingerprint.compute(root);
        String candidateId = UUID.randomUUID().toString();
        AtomicInteger calls = new AtomicInteger();
        when(renderer.render(any(), any(), any())).thenAnswer(invocation -> {
            Path source = invocation.getArgument(0);
            int frames = ((ProjectFilmConfig.FilmConfig) invocation.getArgument(1)).shotTimeline().durationInFrames();
            if (calls.incrementAndGet() == 1) return renderTo(invocation.getArgument(2), frames, 960, 540, 30);
            assertEquals("fm-candidate-" + candidateId.replace("-", ""), Files.readString(source.resolve("film.config.json")).contains(candidateId.replace("-", ""))
                    ? "fm-candidate-" + candidateId.replace("-", "") : "missing candidate source");
            assertEquals(Optional.of(2L), scenes.commitWithSnapshot(project.id(), 1, baseFilm, null,
                    "并发提交", "", "renders/concurrent.mp4", ProjectSceneVersion.SOURCE_TASK, null));
            return renderTo(invocation.getArgument(2), frames, 960, 540, 30);
        });
        mvc.perform(post(PREVIEW, project.id(), 1).contentType(MediaType.APPLICATION_JSON)
                        .content(request(baseFilm.path("sourceHash").asText(), "chart", candidateId, COMPONENT)))
                .andExpect(status().isOk());

        mvc.perform(post(PREVIEW + "/{candidateId}/commit", project.id(), 1, candidateId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("scene_version_conflict"));

        assertEquals(originalHash, ProjectSourceFingerprint.compute(root));
        assertEquals(2, scenes.listVersions(project.id()).size());
        assertFalse(Files.exists(root.resolve("renders/project-shot-" + candidateId + ".mp4")));
        assertFalse(operations.isBusy(project.id()));
    }

    @Test
    void discardRemovesUncommittedCandidatePreview() throws Exception {
        Project project = newShotProject();
        ObjectNode film = saveVersion(project, 0);
        String candidateId = UUID.randomUUID().toString();
        mockSuccessfulRender();
        mvc.perform(post(PREVIEW, project.id(), 1).contentType(MediaType.APPLICATION_JSON)
                        .content(request(film.path("sourceHash").asText(), "chart", candidateId, COMPONENT)))
                .andExpect(status().isOk());

        mvc.perform(delete(PREVIEW + "/{candidateId}", project.id(), 1, candidateId))
                .andExpect(status().isNoContent());
        assertFalse(Files.exists(Path.of(project.rootPath()).resolve(".fengmotion/shot-candidates/" + candidateId)));
        assertEquals(1, scenes.listVersions(project.id()).size());
    }

    private Project newShotProject() throws Exception {
        String id = UUID.randomUUID().toString();
        Path root = Files.createDirectory(workspace.resolve(id));
        Files.createDirectories(root.resolve("src/shots"));
        Files.writeString(root.resolve("src/shots/bars.tsx"), "export const Shot = () => <div>Bars</div>;");
        Files.writeString(root.resolve("src/shots/outro.tsx"), "export const Shot = () => <div>End</div>;");
        Files.writeString(root.resolve("film.config.json"), """
                {"format":"shot-timeline-v1","width":960,"height":540,"fps":30,
                 "shots":[{"id":"chart","sourceId":"bars","label":"Chart","frames":60},
                          {"id":"outro","sourceId":"outro","label":"Outro","frames":30}]}
                """);
        Project project = new Project(id, "镜头候选样例", null, null, root.toString(), Instant.now());
        projects.save(project);
        return project;
    }

    private ObjectNode saveVersion(Project project, long baseVersion) {
        Path root = Path.of(project.rootPath());
        String snapshot = snapshots.capture(root);
        Path saved = root.resolve(snapshot);
        String sourceHash = ProjectSourceFingerprint.compute(saved);
        ShotTimeline timeline = new ShotTimeline(960, 540, 30, 90, List.of(
                new ShotTimeline.Shot("chart", "bars", "Chart", 0, 60),
                new ShotTimeline.Shot("outro", "outro", "Outro", 60, 30)), null);
        ObjectNode film = json.createObjectNode().put("kind", "project-render")
                .put("entry", ShotTimeline.ENTRY).put("compositionId", ShotTimeline.COMPOSITION)
                .put("sourceSnapshot", snapshot).put("sourceHash", sourceHash);
        film.set("shotTimeline", json.valueToTree(timeline));
        film.putObject("output").put("durationInFrames", 90).put("width", 960).put("height", 540).put("fps", 30);
        assertEquals(Optional.of(baseVersion + 1), scenes.commitWithSnapshot(project.id(), baseVersion,
                film, null, "", "", "renders/v" + (baseVersion + 1) + ".mp4", ProjectSceneVersion.SOURCE_TASK, null));
        return film;
    }

    private void mockSuccessfulRender() throws Exception {
        when(renderer.render(any(), any(), any())).thenAnswer(invocation -> {
            ProjectFilmConfig.FilmConfig config = invocation.getArgument(1);
            return renderTo(invocation.getArgument(2), config.shotTimeline().durationInFrames(),
                    config.shotTimeline().width(), config.shotTimeline().height(), config.shotTimeline().fps());
        });
    }

    private ProjectFilmRenderer.Result renderTo(Path output, int frames, int width, int height, int fps) throws Exception {
        Files.createDirectories(output.getParent());
        Files.writeString(output, "rendered video bytes");
        return new ProjectFilmRenderer.Result(output, frames, width, height, fps,
                VideoTimeline.composition(json, frames, fps, "rendered", "sequences"));
    }

    private String request(String sourceHash, String shotId, String requestId, String source) throws Exception {
        ObjectNode request = json.createObjectNode().put("baseVersion", 1).put("sourceHash", sourceHash)
                .put("shotId", shotId).put("componentSource", source).put("requestId", requestId);
        return json.writeValueAsString(request);
    }
}
