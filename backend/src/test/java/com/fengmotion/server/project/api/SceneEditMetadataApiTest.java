package com.fengmotion.server.project.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.service.ProjectSourceFingerprint;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class SceneEditMetadataApiTest {
    private static final String ENDPOINT = "/api/projects/{id}/scene/versions/{version}/edit-metadata";
    private static final String MANIFEST = "src/editable-elements.json";

    @TempDir Path workspace;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired ProjectRepository projects;
    @Autowired ProjectSceneRepository scenes;
    @Autowired ProjectSourceSnapshots snapshots;

    @Test
    void readsEachVersionsTitleFromItsOwnSnapshotWithoutChangingTheWorkingDraft() throws Exception {
        Project project = newProject();
        Path root = Path.of(project.rootPath());
        ObjectNode first = saveTitleVersion(project, 0, "第一版标题");
        ObjectNode second = saveTitleVersion(project, 1, "第二版标题");
        writeTitle(root, "未提交工作稿");
        String workingHash = ProjectSourceFingerprint.compute(root);
        assertNotEquals(first.path("sourceHash").asText(), second.path("sourceHash").asText());

        read(project.id(), 1).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.projectId").value(project.id()))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.status").value("declared"))
                .andExpect(jsonPath("$.artifactPath").value("renders/v1.mp4"))
                .andExpect(jsonPath("$.sourceHash").value(first.path("sourceHash").asText()))
                .andExpect(jsonPath("$.elements.length()").value(1))
                .andExpect(jsonPath("$.elements[0].id").value("intro-title"))
                .andExpect(jsonPath("$.elements[0].kind").value("text"))
                .andExpect(jsonPath("$.elements[0].properties.text").value("第一版标题"));
        read(project.id(), 2).andExpect(status().isOk())
                .andExpect(jsonPath("$.artifactPath").value("renders/v2.mp4"))
                .andExpect(jsonPath("$.sourceHash").value(second.path("sourceHash").asText()))
                .andExpect(jsonPath("$.elements[0].id").value("intro-title"))
                .andExpect(jsonPath("$.elements[0].properties.text").value("第二版标题"));

        assertEquals(workingHash, ProjectSourceFingerprint.compute(root));
        assertEquals(2, scenes.listVersions(project.id()).size());
        assertEquals(2L, scenes.find(project.id()).orElseThrow().version());
    }

    @Test
    void returnsFrameScopedNormalizedPlacementForTheVersionBeingViewed() throws Exception {
        Project project = newProject();
        Path declaration = Path.of(project.rootPath()).resolve(MANIFEST);
        Files.writeString(declaration, """
                {"schemaVersion":1,"elements":[{"id":"intro-title","kind":"text","label":"片头标题","properties":{"text":"可选标题"},"placement":{"startFrame":12,"endFrame":90,"bounds":{"x":0.125,"y":0.25,"w":0.5,"h":0.2}}}]}
                """);
        ObjectNode film = capturedFilm(project);
        film.putObject("output").put("durationInFrames", 120).put("fps", 30);
        saveVersion(project, 0, film);

        read(project.id(), 1).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("declared"))
                .andExpect(jsonPath("$.elements[0].placement.startFrame").value(12))
                .andExpect(jsonPath("$.elements[0].placement.endFrame").value(90))
                .andExpect(jsonPath("$.elements[0].placement.bounds.x").value(0.125))
                .andExpect(jsonPath("$.elements[0].placement.bounds.w").value(0.5));
    }

    @Test
    void neverBorrowsFromTheWorkingTreeWhenTheSnapshotHasNoDeclaration() throws Exception {
        Project project = newProject();
        saveVersion(project, 0, capturedFilm(project));
        writeTitle(Path.of(project.rootPath()), "后来才声明的标题");

        expectPreviewOnly(project, 1, "manifest_missing");
    }

    @Test
    void differentiatesMissingSnapshotAndUnsupportedSourceFromUnknownVersion() throws Exception {
        Project project = newProject();
        saveVersion(project, 0, json.createObjectNode().put("kind", "project-render"));
        saveVersion(project, 1, json.readTree("{\"scenes\":[{\"id\":\"one\",\"text\":\"普通场景\"}]}"));

        expectPreviewOnly(project, 1, "snapshot_missing");
        expectPreviewOnly(project, 2, "unsupported_source");
        read(project.id(), 3).andExpect(status().isNotFound());
        read(newProject().id(), 1).andExpect(status().isNotFound());
        read("unknown-project", 1).andExpect(status().isNotFound());
    }

    @Test
    void rejectsTamperedSnapshotEvenWhenTheLocalFingerprintWasRewritten() throws Exception {
        Project project = newProject();
        ObjectNode film = saveTitleVersion(project, 0, "原始标题");
        Path snapshot = Path.of(project.rootPath()).resolve(film.path("sourceSnapshot").asText());
        writeTitle(snapshot, "被替换的标题");
        Files.writeString(snapshot.resolve("source.sha256"), ProjectSourceFingerprint.compute(snapshot));

        expectPreviewOnly(project, 1, "snapshot_invalid");
    }

    @Test
    @EnabledOnOs({OS.LINUX, OS.MAC})
    void rejectsADeclarationLinkedToTheMutableWorkingTree() throws Exception {
        Project project = newProject();
        ObjectNode film = saveTitleVersion(project, 0, "标题内容未变");
        Path root = Path.of(project.rootPath());
        Path manifest = root.resolve(film.path("sourceSnapshot").asText()).resolve(MANIFEST);
        Files.delete(manifest);
        Files.createSymbolicLink(manifest, root.resolve(MANIFEST));

        expectPreviewOnly(project, 1, "snapshot_invalid");
    }

    @Test
    void failsClosedWhenTheCapturedEntryDoesNotMatchTheRecordedComposition() throws Exception {
        Project project = newProject();
        writeTitle(Path.of(project.rootPath()), "另一合成的标题");
        ObjectNode film = capturedFilm(project).put("compositionId", "Other");
        saveVersion(project, 0, film);

        expectPreviewOnly(project, 1, "snapshot_invalid");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "{\"schemaVersion\":1,\"elements\":[{\"id\":\"intro-title\",\"kind\":\"text\",\"label\":\"标题\",\"properties\":{\"text\":\"第一项\"}},{\"id\":\"intro-title\",\"kind\":\"text\",\"label\":\"重复项\",\"properties\":{\"text\":\"第二项\"}}]}",
            "{\"schemaVersion\":1,\"elements\":[{\"id\":\"intro-title\",\"kind\":\"text\",\"label\":\"标题\",\"properties\":{\"text\":\"标题\",\"text\":\"重复键\"}}]}",
            "{\"schemaVersion\":1,\"elements\":[{\"id\":\"intro-title\",\"kind\":\"text\",\"label\":\"标题\",\"properties\":{\"text\":\"标题\",\"color\":\"blue\"}}]}",
            "{\"schemaVersion\":1,\"elements\":[{\"id\":\"intro-title\",\"kind\":\"text\",\"label\":\"标题\",\"properties\":{\"text\":\"标题\"}}]} {}"
    })
    void rejectsAmbiguousOrUnsupportedDeclarationsAsAWhole(String declaration) throws Exception {
        Project project = newProject();
        Files.writeString(Path.of(project.rootPath()).resolve(MANIFEST), declaration);
        saveVersion(project, 0, capturedFilm(project));

        expectPreviewOnly(project, 1, "manifest_invalid");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "{\"startFrame\":-1,\"endFrame\":20,\"bounds\":{\"x\":0,\"y\":0,\"w\":0.5,\"h\":0.5}}",
            "{\"startFrame\":10,\"endFrame\":121,\"bounds\":{\"x\":0,\"y\":0,\"w\":0.5,\"h\":0.5}}",
            "{\"startFrame\":10,\"endFrame\":20,\"bounds\":{\"x\":0.75,\"y\":0,\"w\":0.5,\"h\":0.5}}",
            "{\"startFrame\":10,\"endFrame\":20,\"bounds\":{\"x\":0,\"y\":0,\"w\":0,\"h\":0.5}}"
    })
    void rejectsPlacementsOutsideCompositionFramesOrCanvas(String placement) throws Exception {
        Project project = newProject();
        Files.writeString(Path.of(project.rootPath()).resolve(MANIFEST), """
                {"schemaVersion":1,"elements":[{"id":"intro-title","kind":"text","label":"标题","properties":{"text":"标题"},"placement":%s}]}
                """.formatted(placement));
        ObjectNode film = capturedFilm(project);
        film.putObject("output").put("durationInFrames", 120).put("fps", 30);
        saveVersion(project, 0, film);

        expectPreviewOnly(project, 1, "manifest_invalid");
    }

    private Project newProject() throws Exception {
        String id = UUID.randomUUID().toString();
        Path root = Files.createDirectory(workspace.resolve(id));
        Files.createDirectory(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), """
                import metadata from './editable-elements.json';
                export const Main = () => <h1>{metadata.elements.find(element => element.id === 'intro-title')?.properties.text}</h1>;
                """);
        Files.writeString(root.resolve("film.config.json"), "{\"entry\":\"src/index.tsx\",\"compositionId\":\"Main\"}");
        Project project = new Project(id, "标题样例", null, null, root.toString(), Instant.now());
        projects.save(project);
        return project;
    }

    private void writeTitle(Path root, String text) throws Exception {
        ObjectNode declaration = json.createObjectNode().put("schemaVersion", 1);
        declaration.putArray("elements").addObject().put("id", "intro-title").put("kind", "text")
                .put("label", "片头标题").putObject("properties").put("text", text);
        Files.writeString(root.resolve(MANIFEST), declaration.toString());
    }

    private ObjectNode saveTitleVersion(Project project, long baseVersion, String text) throws Exception {
        writeTitle(Path.of(project.rootPath()), text);
        ObjectNode film = capturedFilm(project);
        saveVersion(project, baseVersion, film);
        return film;
    }

    private ObjectNode capturedFilm(Project project) {
        Path root = Path.of(project.rootPath());
        String snapshot = snapshots.capture(root);
        return json.createObjectNode().put("kind", "project-render").put("entry", "src/index.tsx")
                .put("compositionId", "Main").put("sourceSnapshot", snapshot)
                .put("sourceHash", ProjectSourceFingerprint.compute(root.resolve(snapshot)));
    }

    private void saveVersion(Project project, long baseVersion, JsonNode film) {
        long version = baseVersion + 1;
        assertEquals(Optional.of(version), scenes.commitWithSnapshot(project.id(), baseVersion, film, null, "", "",
                "renders/v" + version + ".mp4", ProjectSceneVersion.SOURCE_TASK, null));
    }

    private ResultActions read(String projectId, long version) throws Exception {
        return mvc.perform(get(ENDPOINT, projectId, version));
    }

    private void expectPreviewOnly(Project project, long version, String reason) throws Exception {
        read(project.id(), version).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("preview_only"))
                .andExpect(jsonPath("$.reason.code").value(reason))
                .andExpect(jsonPath("$.elements").isEmpty());
    }
}
