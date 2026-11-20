package com.fengmotion.server.render.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.function.BooleanSupplier;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.service.ProjectFilmConfig;

class LivePreviewRuntimeTest {
    @TempDir Path temporary;
    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper json = new ObjectMapper();

    @Test void packagedShellBuildsHotReloadsAndRecoversFromCompilationErrors() throws Exception {
        Path frontend = Path.of("../frontend").toAbsolutePath().normalize();
        Path modules = frontend.resolve("node_modules");
        assumeTrue(Files.isDirectory(modules.resolve("@remotion/player")), "requires shared frontend runtime dependencies");
        Path shell = temporary.resolve("resources/live-preview");
        try (var entries = Files.walk(frontend.resolve("live-preview"))) {
            for (Path source : entries.toList()) {
                Path destination = shell.resolve(frontend.resolve("live-preview").relativize(source));
                if (Files.isDirectory(source)) Files.createDirectories(destination);
                else Files.copy(source, destination);
            }
        }
        Path root = Files.createDirectories(temporary.resolve("project"));
        Path fixtures = Path.of("src/test/shot-replacement/fixtures");
        Files.copy(fixtures.resolve("host.tsx"), root.resolve("index.tsx"));
        Files.copy(fixtures.resolve("Chart.tsx"), root.resolve("Shot.tsx"));
        Files.copy(fixtures.resolve("Frame.tsx"), root.resolve("Frame.tsx"));
        Files.copy(fixtures.resolve("theme.json"), root.resolve("theme.json"));
        Files.writeString(root.resolve("canvas.json"), "{\"width\":960,\"height\":540,\"fps\":30,\"durationInFrames\":120}");
        var launcher = new LivePreviewLauncher(json, shell.toString(), "", modules.toString(), "node", temporary.resolve("data").toString());
        var config = new ProjectFilmConfig.FilmConfig("index.tsx", "PilotShot", 960, 540, 30);
        var process = launcher.launch(root, config);
        try {
            String url = process.awaitReady(Duration.ofSeconds(30));
            assertTrue(process.healthy(url));
            String original = text(url + "bundle.js");
            assertTrue(original.contains("Caffeine per serving"));
            assertTrue(original.contains("data-fm-src"));
            String source = Files.readString(root.resolve("Shot.tsx"));
            Files.writeString(root.resolve("Shot.tsx"), source.replace("Caffeine per serving", "Local preview updated"));
            await(() -> text(url + "bundle.js").contains("Local preview updated"));
            String updated = text(url + "bundle.js");
            Files.writeString(root.resolve("Shot.tsx"), "export const Shot = (");
            await(() -> !buildError(url).isBlank());
            assertEquals(updated, text(url + "bundle.js"));
            assertTrue(process.alive());
            Files.writeString(root.resolve("Shot.tsx"), source.replace("Caffeine per serving", "Recovered preview"));
            await(() -> text(url + "bundle.js").contains("Recovered preview"));
            assertEquals("", buildError(url));
        } finally { process.stop(); }
        assertFalse(process.alive());
    }

    @Test void wrapperPidCanDifferAndPreviewExitsWhenItsParentIsForciblyKilled() throws Exception {
        Path frontend = Path.of("../frontend").toAbsolutePath().normalize();
        Path modules = frontend.resolve("node_modules");
        assumeTrue(Files.isDirectory(modules.resolve("@remotion/player")), "requires shared frontend runtime dependencies");
        Path root = Files.createDirectories(temporary.resolve("wrapped-project"));
        Files.writeString(root.resolve("index.tsx"), """
                import React from 'react';
                import { Composition, registerRoot } from 'remotion';
                registerRoot(() => <Composition id="Main" component={() => <div>Wrapped preview</div>}
                    width={960} height={540} fps={30} durationInFrames={60} />);
                """);
        Path stdout = temporary.resolve("wrapped.stdout");
        Path stderr = temporary.resolve("wrapped.stderr");
        Process wrapper = new ProcessBuilder("node", "src/test/resources/live-preview/wrapper.mjs",
                frontend.resolve("live-preview/server.mjs").toString(), "--project", root.toString(),
                "--entry", "index.tsx", "--composition", "Main", "--node-modules", modules.toString(),
                "--host", "127.0.0.1", "--port", "0")
                .redirectOutput(stdout.toFile()).redirectError(stderr.toFile()).start();
        var preview = new LivePreviewProcess(wrapper, stdout, stderr, json);
        List<ProcessHandle> children = List.of();
        try {
            String url = preview.awaitReady(Duration.ofSeconds(30));
            var signal = json.readTree(Files.readString(stdout).lines().findFirst().orElseThrow());
            long previewPid = signal.path("pid").asLong();
            assertNotEquals(wrapper.pid(), previewPid);
            assertTrue(text(url + "bundle.js").contains("Wrapped preview"));
            children = wrapper.descendants().toList();
            wrapper.destroyForcibly();
            assertTrue(wrapper.waitFor(3, java.util.concurrent.TimeUnit.SECONDS));
            await(() -> {
                try {
                    http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofMillis(500)).GET().build(),
                            HttpResponse.BodyHandlers.discarding());
                    return false;
                } catch (java.io.IOException stopped) { return true; }
                catch (InterruptedException interrupted) { throw new AssertionError(interrupted); }
            });
            assertTrue(Files.readString(stderr).contains("启动进程已退出"));
        } finally {
            preview.stop();
            children.stream().filter(ProcessHandle::isAlive).forEach(ProcessHandle::destroyForcibly);
        }
    }

    @Test void backendWorkingDirectoryFindsSharedDependenciesWhenConfigurationIsEmpty() throws Exception {
        Path frontend = Path.of("../frontend").toAbsolutePath().normalize();
        assumeTrue(Files.isDirectory(frontend.resolve("node_modules/@remotion/player")));
        Path root = Files.createDirectories(temporary.resolve("default-project"));
        Files.writeString(root.resolve("index.tsx"), """
                import React from 'react';
                import { Composition, registerRoot } from 'remotion';
                registerRoot(() => <Composition id="Main" component={() => <div>Default dependencies</div>}
                    width={960} height={540} fps={30} durationInFrames={60} />);
                """);
        var launcher = new LivePreviewLauncher(json, "", "", "", "node", temporary.resolve("data").toString());
        var config = new ProjectFilmConfig.FilmConfig("index.tsx", "Main", 960, 540, 30);
        var preview = launcher.launch(root, config);
        try {
            assertTrue(text(preview.awaitReady(Duration.ofSeconds(30)) + "bundle.js").contains("Default dependencies"));
        } finally { preview.stop(); }
        var invalid = new LivePreviewLauncher(json, frontend.resolve("live-preview").toString(), "",
                temporary.resolve("missing-dependencies").toString(), "node", temporary.resolve("data").toString());
        assertEquals("live_preview_unavailable", assertThrows(com.fengmotion.server.common.ApiException.class,
                () -> invalid.launch(root, config)).getCode());
    }

    private String text(String url) {
        try {
            return http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(2)).GET().build(),
                    HttpResponse.BodyHandlers.ofString()).body();
        } catch (Exception failure) { throw new AssertionError(failure); }
    }

    @Test void actualScriptReportsMissingBabelParserBeforeBuilding() throws Exception {
        Path frontend = Path.of("../frontend").toAbsolutePath().normalize();
        Path modules = Files.createDirectories(temporary.resolve("node_modules"));
        for (String name : List.of("esbuild", "@babel/core")) {
            Path stub = Files.createDirectories(modules.resolve(name));
            Files.writeString(stub.resolve("index.js"), "module.exports = {};");
        }
        Path root = Files.createDirectories(temporary.resolve("project"));
        Files.writeString(root.resolve("index.tsx"), "export default null;");
        var launcher = new LivePreviewLauncher(json, frontend.resolve("live-preview").toString(), "", modules.toString(),
                "node", temporary.resolve("data").toString());
        var preview = launcher.launch(root, new ProjectFilmConfig.FilmConfig("index.tsx", "Main", 960, 540, 30));
        try {
            var failure = assertThrows(com.fengmotion.server.common.ApiException.class,
                    () -> preview.awaitReady(Duration.ofSeconds(10)));
            assertEquals("live_preview_unavailable", failure.getCode());
            try (var logs = Files.list(temporary.resolve("data/logs/live-preview"))) {
                Path stdout = logs.filter(file -> file.toString().endsWith(".stdout.log")).findFirst().orElseThrow();
                var signal = json.readTree(Files.readString(stdout).lines().findFirst().orElseThrow());
                assertEquals("dependency_missing", signal.path("code").asText());
                assertTrue(signal.path("message").asText().contains("@babel/parser"));
            }
        } finally { preview.stop(); }
    }

    private String buildError(String url) {
        try {
            var response = http.send(HttpRequest.newBuilder(URI.create(url + "events")).timeout(Duration.ofSeconds(2))
                    .GET().build(), HttpResponse.BodyHandlers.ofInputStream());
            try (var reader = new java.io.BufferedReader(new java.io.InputStreamReader(response.body()))) {
                assertEquals("event: hello", reader.readLine());
                return json.readTree(reader.readLine().substring(6)).path("error").asText("");
            }
        } catch (Exception failure) { throw new AssertionError(failure); }
    }

    private static void await(BooleanSupplier check) throws Exception {
        long end = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        while (System.nanoTime() < end) {
            if (check.getAsBoolean()) return;
            Thread.sleep(100);
        }
        fail("preview did not rebuild within 15 seconds");
    }
}
