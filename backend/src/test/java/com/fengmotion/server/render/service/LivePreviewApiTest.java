package com.fengmotion.server.render.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fengmotion.server.common.ApiExceptionHandler;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.service.ProjectSourceFingerprint;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.render.api.LivePreviewController;

class LivePreviewApiTest {
    @TempDir Path temporary;
    private final ObjectMapper json = new ObjectMapper().registerModule(new JavaTimeModule());
    private LivePreviewService service;
    private MockMvc mvc;
    private Path root;

    @BeforeEach void setup() throws Exception {
        root = Files.createDirectories(temporary.resolve("project with spaces/src")).getParent();
        Files.writeString(root.resolve("src/index.tsx"), "export default null;");
        configure("Main");
        var projects = mock(ProjectRepository.class);
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project", "sample", null, null, root.toString(), Instant.now())));
        var launcher = new LivePreviewLauncher(json, Path.of("src/test/resources/live-preview").toAbsolutePath().toString(),
                "", temporary.toString(), "node", temporary.resolve("data").toString());
        service = new LivePreviewService(projects, new ProjectFilmConfig(json), launcher, Duration.ofMillis(500),
                Duration.ofMinutes(10), Clock.systemUTC());
        mvc = MockMvcBuilders.standaloneSetup(new LivePreviewController(service))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @AfterEach void close() { service.close(); }

    @Test void realProcessRoundTripReusesUrlAndLeavesSourcesUntouched() throws Exception {
        String hash = ProjectSourceFingerprint.compute(root);
        mvc.perform(get("/api/projects/project/live-preview")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("stopped")).andExpect(jsonPath("$.url").isEmpty());
        String response = mvc.perform(post("/api/projects/project/live-preview")).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.compositionId").value("Main")).andReturn().getResponse().getContentAsString();
        String url = json.readTree(response).path("url").asText();
        var request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(2)).GET().build();
        assertEquals("preview fixture", HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString()).body());
        mvc.perform(post("/api/projects/project/live-preview")).andExpect(jsonPath("$.url").value(url));
        mvc.perform(get("/api/projects/project/live-preview")).andExpect(jsonPath("$.status").value("ready"));
        mvc.perform(delete("/api/projects/project/live-preview")).andExpect(status().isNoContent());
        mvc.perform(delete("/api/projects/project/live-preview")).andExpect(status().isNoContent());
        mvc.perform(get("/api/projects/project/live-preview")).andExpect(jsonPath("$.status").value("stopped"));
        assertEquals(hash, ProjectSourceFingerprint.compute(root));
        assertFalse(Files.exists(root.resolve(".fengmotion")));
        assertThrows(java.io.IOException.class, () -> HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.discarding()));
    }

    @ParameterizedTest @ValueSource(strings = {"DependencyMissing", "ExitEarly", "InvalidSignal"})
    void failedHandshakeReturnsContractErrorAndAllowsRestart(String composition) throws Exception {
        configure(composition);
        mvc.perform(post("/api/projects/project/live-preview")).andExpect(status().isUnprocessableEntity())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.error.code").value("live_preview_unavailable"));
        configure("Main");
        mvc.perform(post("/api/projects/project/live-preview")).andExpect(status().isOk());
    }

    @Test void timeoutCleansProcessAndMissingProjectIs404() throws Exception {
        configure("Timeout");
        mvc.perform(post("/api/projects/project/live-preview")).andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.error.code").value("live_preview_start_timeout"));
        var pids = json.readTree(temporary.resolve("fixture-process.json").toFile());
        for (String name : new String[]{"pid", "child"}) {
            long pid = pids.path(name).asLong();
            assertTrue(pid > 0);
            var handle = ProcessHandle.of(pid);
            if (handle.isPresent()) handle.get().onExit().get(3, java.util.concurrent.TimeUnit.SECONDS);
            assertFalse(ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false));
        }
        mvc.perform(get("/api/projects/project/live-preview")).andExpect(jsonPath("$.status").value("stopped"));
        mvc.perform(post("/api/projects/missing/live-preview")).andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(get("/api/projects/missing/live-preview")).andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(delete("/api/projects/missing/live-preview")).andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control", "no-store"));
        configure("Main");
        mvc.perform(post("/api/projects/project/live-preview")).andExpect(status().isOk());
    }

    @Test void shutdownReturnsDedicatedUnavailableCodeAndNoStore() throws Exception {
        service.close();
        mvc.perform(post("/api/projects/project/live-preview")).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("live_preview_stopping"))
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    private void configure(String composition) throws Exception {
        Files.writeString(root.resolve("film.config.json"), json.createObjectNode()
                .put("entry", "src/index.tsx").put("compositionId", composition).toString());
    }
}
