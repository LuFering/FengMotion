package com.fengmotion.server.project.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

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
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.creation.service.ProjectCreationService;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
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
class SceneElementEditApiTest {
    private static final String ENDPOINT = "/api/projects/{id}/scene/versions/{version}/edit";
    private static final String MANIFEST = "src/editable-elements.json";
    private static final String SNAPSHOTS = ".fengmotion/source-snapshots";

    @TempDir Path workspace;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired ProjectRepository projects;
    @Autowired ProjectSceneRepository scenes;
    @Autowired ProjectSourceSnapshots snapshots;
    @Autowired ProjectOperationLock operations;
    @Autowired ProjectCreationService creation;
    @MockBean ProjectFilmRenderer renderer;

    @Test
    void commitsEditedTextAndKeepsItInTheNextOrdinaryRender() throws Exception {
        Project project = newProject();
        ObjectNode originalFilm = saveVersion(project, 0, "第一版标题");
        Path root = Path.of(project.rootPath());
        String oldSnapshot = originalFilm.path("sourceSnapshot").asText();
        Path oldManifest = root.resolve(oldSnapshot).resolve(MANIFEST);
        String oldSnapshotBefore = Files.readString(oldManifest);
        when(renderer.render(any(), any(), any())).thenAnswer(invocation -> {
            Path source = invocation.getArgument(0);
            assertEquals(root.resolve(SNAPSHOTS), source.getParent());
            assertEquals("新标题", json.readTree(source.resolve(MANIFEST).toFile())
                    .path("elements").path(0).path("properties").path("text").asText());
            return renderTo(invocation.getArgument(2), 120);
        });

        mvc.perform(post(ENDPOINT, project.id(), 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(1, originalFilm.path("sourceHash").asText(), "intro-title", "新标题")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.projectId").value(project.id()))
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.elementId").value("intro-title"))
                .andExpect(jsonPath("$.properties.text").value("新标题"))
                .andExpect(jsonPath("$.artifactPath").value(org.hamcrest.Matchers.startsWith("renders/project-element-")));

        var latest = scenes.findVersion(project.id(), 2).orElseThrow();
        assertEquals(ProjectSceneVersion.SOURCE_ELEMENT_EDIT, latest.source());
        String newHash = latest.film().path("sourceHash").asText();
        assertNotEquals(originalFilm.path("sourceHash").asText(), newHash);
        assertEquals(newHash, ProjectSourceFingerprint.compute(root));
        assertEquals("新标题", readMetadata(project.id(), 2).path("elements").path(0).path("properties").path("text").asText());
        assertEquals(oldSnapshotBefore, Files.readString(oldManifest));
        Path video = root.resolve(latest.artifactPath());
        assertTrue(Files.isRegularFile(video));
        assertEquals(newHash, VideoTimeline.read(json, video, latest.artifactPath()).orElseThrow().path("sourceHash").asText());
        assertFalse(operations.isBusy(project.id()));

        assertEquals(3L, creation.render(project.id(), "再次渲染").version());
        assertEquals("新标题", readMetadata(project.id(), 3).path("elements").path(0).path("properties").path("text").asText());
    }

    @Test
    void rejectsStaleVersionBeforeRendering() throws Exception {
        Project project = newProject();
        ObjectNode first = saveVersion(project, 0, "第一版");
        saveVersion(project, 1, "第二版");

        mvc.perform(post(ENDPOINT, project.id(), 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(1, first.path("sourceHash").asText(), "intro-title", "过期编辑")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("scene_version_conflict"));

        verify(renderer, never()).render(any(), any(), any());
        assertEquals(2, scenes.listVersions(project.id()).size());
    }

    @Test
    void rejectsStaleSourceHashAndUnknownElementWithoutRendering() throws Exception {
        Project project = newProject();
        ObjectNode film = saveVersion(project, 0, "第一版");

        mvc.perform(post(ENDPOINT, project.id(), 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(1, "files=1;sha256=" + "0".repeat(64), "intro-title", "新标题")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("source_version_conflict"));
        mvc.perform(post(ENDPOINT, project.id(), 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(1, film.path("sourceHash").asText(), "missing", "新标题")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("element_not_found"));

        verify(renderer, never()).render(any(), any(), any());
        assertEquals(1, scenes.listVersions(project.id()).size());
    }

    @Test
    void refusesUnsupportedPropertiesAndPathBodyVersionMismatch() throws Exception {
        Project project = newProject();
        ObjectNode film = saveVersion(project, 0, "第一版");

        mvc.perform(post(ENDPOINT, project.id(), 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestWithProperties(1, film.path("sourceHash").asText(), "intro-title",
                                json.readTree("{\"text\":\"新标题\",\"fontSize\":80}"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("unsupported_element_property"));
        mvc.perform(post(ENDPOINT, project.id(), 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(2, film.path("sourceHash").asText(), "intro-title", "新标题")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_error"));

        verify(renderer, never()).render(any(), any(), any());
        assertEquals(1, scenes.listVersions(project.id()).size());
    }

    @Test
    void renderFailureRemovesPartialArtifactAndKeepsSourceAndVersionUnchanged() throws Exception {
        Project project = newProject();
        ObjectNode film = saveVersion(project, 0, "第一版");
        Path root = Path.of(project.rootPath());
        String workingBefore = Files.readString(root.resolve("src/editable-elements.json"));
        when(renderer.render(any(), any(), any())).thenAnswer(invocation -> {
            Path output = invocation.getArgument(2);
            Files.createDirectories(output.getParent());
            Files.writeString(output, "partial");
            throw new ApiException(org.springframework.http.HttpStatus.BAD_GATEWAY, "render_failed", "渲染失败");
        });

        mvc.perform(post(ENDPOINT, project.id(), 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(1, film.path("sourceHash").asText(), "intro-title", "失败修改")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("render_failed"));

        assertEquals(1, scenes.listVersions(project.id()).size());
        assertEquals(1L, scenes.find(project.id()).orElseThrow().version());
        assertEquals(workingBefore, Files.readString(root.resolve("src/editable-elements.json")));
        assertFalse(Files.exists(root.resolve("renders")) && containsMp4(root.resolve("renders")));
        assertOnlyOriginalSnapshot(root);
        assertFalse(operations.isBusy(project.id()));
    }

    @Test
    void rejectsUnsavedWorkingSourceBeforeRendering() throws Exception {
        Project project = newProject();
        ObjectNode film = saveVersion(project, 0, "第一版");
        Path root = Path.of(project.rootPath());
        writeManifest(root, "未提交标题");
        String workingHash = ProjectSourceFingerprint.compute(root);

        submit(project, film).andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("working_source_conflict"));

        verify(renderer, never()).render(any(), any(), any());
        assertEquals(workingHash, ProjectSourceFingerprint.compute(root));
        assertOnlyOriginalSnapshot(root);
    }

    @Test
    void preservesAnExternalSourceChangeMadeDuringRender() throws Exception {
        Project project = newProject();
        ObjectNode film = saveVersion(project, 0, "第一版");
        Path root = Path.of(project.rootPath());
        when(renderer.render(any(), any(), any())).thenAnswer(invocation -> {
            writeManifest(root, "渲染期间的外部修改");
            return renderTo(invocation.getArgument(2), 120);
        });

        submit(project, film).andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("working_source_conflict"));

        assertTrue(Files.readString(root.resolve(MANIFEST)).contains("渲染期间的外部修改"));
        assertEquals(1L, scenes.find(project.id()).orElseThrow().version());
        assertFalse(containsMp4(root.resolve("renders")));
        assertOnlyOriginalSnapshot(root);
    }

    @Test
    void rollsBackManifestAndDiscardsArtifactsWhenTheVersionCommitLoses() throws Exception {
        Project project = newProject();
        ObjectNode film = saveVersion(project, 0, "第一版");
        Path root = Path.of(project.rootPath());
        String original = Files.readString(root.resolve(MANIFEST));
        when(renderer.render(any(), any(), any())).thenAnswer(invocation -> {
            assertEquals(Optional.of(2L), scenes.commitWithSnapshot(project.id(), 1, film, null,
                    "其他提交", "", "renders/other.mp4", ProjectSceneVersion.SOURCE_TASK, null));
            return renderTo(invocation.getArgument(2), 120);
        });

        submit(project, film).andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("scene_version_conflict"));

        assertEquals(original, Files.readString(root.resolve(MANIFEST)));
        assertEquals(2, scenes.listVersions(project.id()).size());
        assertEquals("renders/other.mp4", scenes.findVersion(project.id(), 2).orElseThrow().artifactPath());
        assertFalse(containsMp4(root.resolve("renders")));
        assertOnlyOriginalSnapshot(root);
        assertFalse(operations.isBusy(project.id()));
    }

    @Test
    void rejectsMissingDeclaration() throws Exception {
        Project project = newProject();
        Path root = Path.of(project.rootPath());
        Files.delete(root.resolve("src/editable-elements.json"));
        ObjectNode film = captureFilm(project, 0);
        assertEquals(Optional.of(1L), scenes.commitWithSnapshot(project.id(), 0, film, null,
                "", "", "renders/v1.mp4", ProjectSceneVersion.SOURCE_TASK, null));

        mvc.perform(post(ENDPOINT, project.id(), 1)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(1, film.path("sourceHash").asText(), "intro-title", "新标题")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("element_edit_unavailable"));

        verify(renderer, never()).render(any(), any(), any());
        assertEquals(1, scenes.listVersions(project.id()).size());
    }

    private Project newProject() throws Exception {
        String id = UUID.randomUUID().toString();
        Path root = Files.createDirectory(workspace.resolve(id));
        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "export const Main = () => null;\n");
        Files.writeString(root.resolve("film.config.json"),
                "{\"entry\":\"src/index.tsx\",\"compositionId\":\"Main\"}");
        writeManifest(root, "初始标题");
        Project project = new Project(id, "元素编辑样例", null, null, root.toString(), Instant.now());
        projects.save(project);
        return project;
    }

    private ObjectNode saveVersion(Project project, long baseVersion, String text) throws Exception {
        writeManifest(Path.of(project.rootPath()), text);
        ObjectNode film = captureFilm(project, 120);
        assertEquals(Optional.of(baseVersion + 1), scenes.commitWithSnapshot(project.id(), baseVersion, film, null,
                "", "", "renders/v" + (baseVersion + 1) + ".mp4", ProjectSceneVersion.SOURCE_TASK, null));
        return film;
    }

    private ObjectNode captureFilm(Project project, int frames) {
        Path root = Path.of(project.rootPath());
        String snapshot = snapshots.capture(root);
        ObjectNode film = json.createObjectNode().put("kind", "project-render").put("entry", "src/index.tsx")
                .put("compositionId", "Main").put("sourceSnapshot", snapshot)
                .put("sourceHash", ProjectSourceFingerprint.compute(root.resolve(snapshot)));
        film.putObject("output").put("durationInFrames", frames).put("fps", 30);
        return film;
    }

    private void writeManifest(Path root, String text) throws Exception {
        Files.writeString(root.resolve("src/editable-elements.json"), """
                {"schemaVersion":1,"elements":[{"id":"intro-title","kind":"text","label":"片头标题","properties":{"text":"%s"},"placement":{"startFrame":0,"endFrame":90,"bounds":{"x":0.1,"y":0.1,"w":0.8,"h":0.2}}}]}
                """.formatted(text));
    }

    private ProjectFilmRenderer.Result renderTo(Path output, int frames) throws Exception {
        Files.createDirectories(output.getParent());
        Files.writeString(output, "rendered video bytes");
        return new ProjectFilmRenderer.Result(output, frames, 1280, 720, 30,
                VideoTimeline.composition(json, frames, 30, "rendered", "unavailable"));
    }

    private org.springframework.test.web.servlet.ResultActions submit(Project project, ObjectNode film) throws Exception {
        return mvc.perform(post(ENDPOINT, project.id(), 1).contentType(MediaType.APPLICATION_JSON)
                .content(request(1, film.path("sourceHash").asText(), "intro-title", "新标题")));
    }

    private void assertOnlyOriginalSnapshot(Path root) throws Exception {
        try (var directories = Files.list(root.resolve(SNAPSHOTS))) {
            assertEquals(1, directories.count());
        }
    }

    private String request(long baseVersion, String sourceHash, String elementId, String text) {
        return "{\"baseVersion\":" + baseVersion + ",\"sourceHash\":" + json.valueToTree(sourceHash)
                + ",\"elementId\":" + json.valueToTree(elementId) + ",\"properties\":{\"text\":"
                + json.valueToTree(text) + "}}";
    }

    private String requestWithProperties(long baseVersion, String sourceHash, String elementId, Object properties) {
        return "{\"baseVersion\":" + baseVersion + ",\"sourceHash\":" + json.valueToTree(sourceHash)
                + ",\"elementId\":" + json.valueToTree(elementId) + ",\"properties\":" + properties + "}";
    }

    private com.fasterxml.jackson.databind.JsonNode readMetadata(String projectId, long version) throws Exception {
        var result = mvc.perform(get("/api/projects/{id}/scene/versions/{version}/edit-metadata", projectId, version))
                .andExpect(status().isOk());
        return json.readTree(result.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    private boolean containsMp4(Path directory) throws Exception {
        try (var files = Files.list(directory)) {
            return files.anyMatch(path -> path.getFileName().toString().endsWith(".mp4")
                    || path.getFileName().toString().endsWith(".sequences.json"));
        }
    }
}
