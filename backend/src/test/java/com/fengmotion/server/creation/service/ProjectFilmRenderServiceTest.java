package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.store.CreationStateStore;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.ProjectFilmRenderer;

class ProjectFilmRenderServiceTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test void rejectsRenderDirectorySymlinkBeforeStartingRenderer() throws Exception {
        Path root=projectRoot();
        Path outside=Files.createTempDirectory("fm-render-outside-");
        try {
            Files.createSymbolicLink(root.resolve("renders"),outside);
            var renderer=mock(ProjectFilmRenderer.class);
            var service=service(root,mock(ProjectSceneRepository.class),renderer,mock(CreationStateStore.class));
            assertEquals("render_path_invalid",assertThrows(ApiException.class,()->service.render("project","render")).getCode());
            verify(renderer,never()).render(any(),any(),any());
            try(var files=Files.list(outside)) { assertEquals(0,files.count()); }
        } finally { Files.delete(outside); }
    }

    @Test
    void explicitShotCreationCannotFallBackToLegacyEntry() throws Exception {
        Path root = projectRoot();
        var scenes = mock(ProjectSceneRepository.class);
        var renderer = mock(ProjectFilmRenderer.class);
        var service = service(root, scenes, renderer, mock(CreationStateStore.class));

        var error = assertThrows(ApiException.class, () -> service.render("project", "chart explainer", true));
        assertEquals("shot_timeline_required", error.getCode());
        verify(renderer, never()).render(any(), any(), any());
    }

    @Test void corruptCurrentSceneIsRejectedBeforeSnapshotAndRender() throws Exception {
        Path root = projectRoot();
        var scenes = mock(ProjectSceneRepository.class);
        when(scenes.find("project")).thenReturn(Optional.of(new com.fengmotion.server.project.domain.ProjectScene("project", 1, null, null, Instant.now())));
        var renderer = mock(ProjectFilmRenderer.class);
        var service = service(root, scenes, renderer, mock(CreationStateStore.class));
        assertEquals("scene_corrupt", assertThrows(ApiException.class, () -> service.render("project", "render")).getCode());
        verifyNoRender(renderer);
        assertFalse(Files.exists(root.resolve(".fengmotion/source-snapshots")));
    }

    private void verifyNoRender(ProjectFilmRenderer renderer) { org.mockito.Mockito.verifyNoInteractions(renderer); }

    private Path projectRoot() throws Exception {
        Path root = Files.createTempDirectory("project-film-render-");
        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "export const Main = () => null;\n");
        Files.writeString(root.resolve("film.config.json"), """
                {"entry":"src/index.tsx","compositionId":"Main","width":1920,"height":1080,"fps":24}
                """);
        return root;
    }

    private ProjectFilmRenderService service(Path root, ProjectSceneRepository scenes,
                                             ProjectFilmRenderer renderer,
                                             CreationStateStore creationStates) {
        ProjectRepository projects = mock(ProjectRepository.class);
        when(projects.findById("project")).thenReturn(Optional.of(
                new Project("project", "Demo", null, null, root.toString(), Instant.now())));
        return new ProjectFilmRenderService(projects, scenes, new ProjectFilmConfig(json), renderer,
                json, creationStates, new ProjectSourceSnapshots());
    }

    @Test
    void snapshotsRendersAndCommitsSourceFingerprintAsOneVersion() throws Exception {
        Path root = projectRoot();
        Path snapshot = root.resolve(".fengmotion/source-snapshots/snapshot-one");
        ProjectSceneRepository scenes = mock(ProjectSceneRepository.class);
        when(scenes.find("project")).thenReturn(Optional.empty());
        when(scenes.commitWithSnapshot(eq("project"), eq(0L), any(), eq(null), eq("render"),
                eq("渲染项目工程 src/index.tsx · Main"), any(), eq("task"), eq(null)))
                .thenReturn(Optional.of(1L));
        ProjectFilmRenderer renderer = mock(ProjectFilmRenderer.class);
        when(renderer.render(any(), any(), any())).thenAnswer(invocation -> {
            Path output = invocation.getArgument(2);
            Files.createDirectories(output.getParent());
            Files.writeString(output, "rendered");
            return new ProjectFilmRenderer.Result(output, 240, 1920, 1080, 24, null,
                    json.createObjectNode().put("remotion", "4.0.519").put("react", "19.0.0"));
        });
        CreationStateStore creationStates = mock(CreationStateStore.class);
        var references = json.readTree("[{\"id\":\"resource-1\"}]");
        when(creationStates.read(root)).thenReturn(new CreationStateStore.State("running", "intent", null,
                references, null, null, null, "now"));

        var service = service(root, scenes, renderer, creationStates);
        var result = service.render("project", "render");

        assertEquals(1L, result.version());
        assertEquals("renders/" + Path.of(result.artifactPath()).getFileName(), result.artifactPath());
        assertEquals("src/index.tsx", result.entry());
        assertEquals("Main", result.compositionId());
        assertEquals(240, result.result().durationInFrames());
        assertEquals(java.util.List.of("film.config.json", "src/index.tsx"), service.sourceFiles(root));
        verify(scenes).commitWithSnapshot(eq("project"), eq(0L), any(), eq(null), eq("render"),
                eq("渲染项目工程 src/index.tsx · Main"), eq(result.artifactPath()), eq("task"), eq(null));

        var invocation = org.mockito.Mockito.mockingDetails(scenes).getInvocations().stream()
                .filter(call -> call.getMethod().getName().equals("commitWithSnapshot"))
                .findFirst().orElseThrow();
        var film = (com.fasterxml.jackson.databind.node.ObjectNode) invocation.getArgument(2);
        assertEquals("project-render", film.path("kind").asText());
        assertEquals("src/index.tsx", film.path("entry").asText());
        assertEquals("files=2", film.path("sourceHash").asText().split(";", 2)[0]);
        assertTrue(film.path("sources").toString().contains("src/index.tsx"));
        assertEquals(references, film.path("resources"));
        assertEquals("4.0.519", film.path("dependencies").path("remotion").asText());
        assertEquals("19.0.0", film.path("dependencies").path("react").asText());
        assertNotNull(film.path("sourceSnapshot").asText());
        assertTrue(Files.isDirectory(snapshot.getParent()));
        assertTrue(Files.isRegularFile(root.resolve(result.artifactPath())));
    }

    @Test
    void sourceManifestIncludesRootDependenciesButNotProjectState() throws Exception {
        Path root = projectRoot();
        Files.writeString(root.resolve("index.tsx"), "root entry");
        Files.writeString(root.resolve("theme.json"), "{}");
        Files.writeString(root.resolve("project.json"), "project state");
        Files.writeString(root.resolve("creation-state.json"), "job state");
        Files.createDirectory(root.resolve("components"));
        Files.writeString(root.resolve("components/Title.tsx"), "title");
        var sources = ProjectFilmRenderService.sourceEntries(json, root);
        var names = new java.util.ArrayList<String>();
        sources.forEach(item -> names.add(item.path("path").asText()));
        assertEquals(java.util.List.of("components/Title.tsx", "film.config.json", "index.tsx", "src/index.tsx", "theme.json"), names);
        Files.createSymbolicLink(root.resolve("components/link.tsx"), root.resolve("index.tsx"));
        assertEquals("source_unreadable", assertThrows(ApiException.class,
                () -> ProjectFilmRenderService.sourceEntries(json, root)).getCode());
    }

    @Test
    void deletesUncommittedOutputAndRejectsRenderWhenOptimisticCommitConflicts() throws Exception {
        Path root = projectRoot();
        ProjectSceneRepository scenes = mock(ProjectSceneRepository.class);
        when(scenes.find("project")).thenReturn(Optional.empty());
        when(scenes.commitWithSnapshot(any(), anyLong(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(Optional.empty());
        ProjectFilmRenderer renderer = mock(ProjectFilmRenderer.class);
        when(renderer.render(any(), any(), any())).thenAnswer(invocation -> {
            Path output = invocation.getArgument(2);
            Files.createDirectories(output.getParent());
            Files.writeString(output, "not committed");
            return new ProjectFilmRenderer.Result(output, 1, 1280, 720, 30);
        });
        var service = service(root, scenes, renderer, mock(CreationStateStore.class));

        ApiException failure = assertThrows(ApiException.class, () -> service.render("project", null));

        assertEquals("scene_version_conflict", failure.getCode());
        try (var renders = Files.list(root.resolve("renders"))) {
            assertFalse(renders.findAny().isPresent());
        }
        verify(scenes).commitWithSnapshot(eq("project"), eq(0L), any(), eq(null), eq(""),
                eq("渲染项目工程 src/index.tsx · Main"), any(), eq("task"), eq(null));
    }

    @Test
    void rejectsMissingConfigBeforeSnapshotOrRender() throws Exception {
        Path root = Files.createTempDirectory("project-film-no-config-");
        var scenes = mock(ProjectSceneRepository.class);
        var renderer = mock(ProjectFilmRenderer.class);
        var service = service(root, scenes, renderer, mock(CreationStateStore.class));

        ApiException failure = assertThrows(ApiException.class, () -> service.render("project", null));

        assertEquals("film_config_missing", failure.getCode());
        verify(scenes, never()).commitWithSnapshot(any(), anyLong(), any(), any(), any(), any(), any(), any(), any());
        verify(renderer, never()).render(any(), any(), any());
        try (var files = Files.walk(root)) {
            assertFalse(files.anyMatch(path -> path.toString().contains("source-snapshots")));
        }
    }
}
