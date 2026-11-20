package com.fengmotion.server.render.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.store.ProjectRepository;

class LivePreviewServiceTest {
    @TempDir Path root;
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final LivePreviewLauncher launcher = mock(LivePreviewLauncher.class);
    private final AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-20T00:00:00Z"));
    private LivePreviewService service;

    @BeforeEach void setup() throws Exception {
        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "export const Main = () => null;");
        Files.writeString(root.resolve("film.config.json"), "{\"entry\":\"src/index.tsx\",\"compositionId\":\"Main\"}");
        Clock clock = mock(Clock.class);
        when(clock.instant()).thenAnswer(invocation -> now.get());
        service = new LivePreviewService(projects, new ProjectFilmConfig(new ObjectMapper()), launcher,
                Duration.ofSeconds(1), Duration.ofMinutes(10), clock);
    }

    @AfterEach void close() { service.close(); }

    private void project(String id) {
        when(projects.findById(id)).thenReturn(Optional.of(new Project(id, id, null, null, root.toString(), now.get())));
    }

    private LivePreviewProcess process(int port) {
        LivePreviewProcess process = mock(LivePreviewProcess.class);
        when(process.alive()).thenReturn(true);
        when(process.healthy(any())).thenReturn(true);
        when(process.awaitReady(any())).thenReturn("http://127.0.0.1:" + port + "/");
        return process;
    }

    @Test void sharesConcurrentStartupWithoutBlockingStatusOrStop() throws Exception {
        project("first");
        var process = process(43120);
        var entered = new CountDownLatch(1);
        var finish = new CountDownLatch(1);
        when(launcher.launch(any(), any())).thenReturn(process);
        when(process.awaitReady(any())).thenAnswer(invocation -> {
            entered.countDown();
            assertTrue(finish.await(3, TimeUnit.SECONDS));
            return "http://127.0.0.1:43120/";
        });
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> service.start("first"));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            var second = executor.submit(() -> service.start("first"));
            assertEquals("stopped", service.get("first").status());
            finish.countDown();
            assertEquals(first.get(3, TimeUnit.SECONDS), second.get(3, TimeUnit.SECONDS));
            verify(launcher, times(1)).launch(any(), any());
        } finally { finish.countDown(); }
    }

    @Test void stopDuringStartupCannotPublishAStoppedProcess() throws Exception {
        project("first");
        var process = process(43120);
        var entered = new CountDownLatch(1);
        var finish = new CountDownLatch(1);
        when(launcher.launch(any(), any())).thenReturn(process);
        when(process.awaitReady(any())).thenAnswer(invocation -> {
            entered.countDown();
            assertTrue(finish.await(3, TimeUnit.SECONDS));
            return "http://127.0.0.1:43120/";
        });
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var pending = executor.submit(() -> service.start("first"));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            service.stop("first");
            finish.countDown();
            assertThrows(java.util.concurrent.ExecutionException.class, () -> pending.get(3, TimeUnit.SECONDS));
            assertEquals("stopped", service.get("first").status());
            verify(process, atLeastOnce()).stop();
        } finally { finish.countDown(); }
    }

    @Test void heartbeatExtendsIdleButQueryDoesNot() {
        project("first");
        var process = process(43120);
        when(launcher.launch(any(), any())).thenReturn(process);
        var started = service.start("first");
        now.updateAndGet(time -> time.plusSeconds(540));
        assertEquals(started, service.start("first"));
        now.updateAndGet(time -> time.plusSeconds(540));
        assertEquals("ready", service.get("first").status());
        now.updateAndGet(time -> time.plusSeconds(61));
        service.reap();
        assertEquals("stopped", service.get("first").status());
        verify(launcher, times(1)).launch(any(), any());
        verify(process).stop();
    }

    @Test void fourthProjectEvictsLeastRecentlyPostedSession() {
        for (String id : new String[]{"first", "second", "third", "fourth"}) project(id);
        var first = process(43120);
        var second = process(43121);
        var third = process(43122);
        var fourth = process(43123);
        when(launcher.launch(any(), any())).thenReturn(first, second, third, fourth);
        service.start("first");
        now.updateAndGet(time -> time.plusSeconds(1));
        service.start("second");
        now.updateAndGet(time -> time.plusSeconds(1));
        service.start("third");
        now.updateAndGet(time -> time.plusSeconds(1));
        service.start("first");
        service.start("fourth");
        verify(second).stop();
        verify(first, never()).stop();
        assertEquals("stopped", service.get("second").status());
    }

    @Test void crashedProcessRestartsButHttpFailureDoesNotKillARebuildingProcess() {
        project("first");
        var first = process(43120);
        var second = process(43121);
        when(launcher.launch(any(), any())).thenReturn(first, second);
        service.start("first");
        when(first.alive()).thenReturn(false);
        assertEquals("http://127.0.0.1:43121/", service.start("first").url());
        verify(first).stop();
        when(second.healthy(any())).thenReturn(false);
        for (int attempt = 0; attempt < 3; attempt++) assertEquals("ready", service.get("first").status());
        verify(second, never()).stop();
        when(second.healthy(any())).thenReturn(true);
        assertEquals("ready", service.get("first").status());
    }

    @Test void startupTimeoutClearsSessionAndAllowsRetry() {
        project("first");
        var failed = process(43120);
        var retry = process(43121);
        when(failed.awaitReady(any())).thenThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                "live_preview_start_timeout", "timeout"));
        when(launcher.launch(any(), any())).thenReturn(failed, retry);
        assertEquals("live_preview_start_timeout", assertThrows(ApiException.class, () -> service.start("first")).getCode());
        verify(failed).stop();
        assertEquals("ready", service.start("first").status());
    }

    @Test void rejectsMissingAndExternalEntrypointsWithoutLaunching() throws Exception {
        project("first");
        Files.delete(root.resolve("film.config.json"));
        assertEquals("live_preview_unavailable", assertThrows(ApiException.class, () -> service.start("first")).getCode());
        Path outside = Files.createTempFile("preview-entry-", ".tsx");
        try {
            Files.createSymbolicLink(root.resolve("src/escape.tsx"), outside);
            Files.writeString(root.resolve("film.config.json"), "{\"entry\":\"src/escape.tsx\",\"compositionId\":\"Main\"}");
            assertThrows(ApiException.class, () -> service.start("first"));
        } finally { Files.delete(outside); }
        verifyNoInteractions(launcher);
    }

    @Test void deletionAndShutdownReleaseAllProcesses() {
        project("first");
        project("second");
        var first = process(43120);
        var second = process(43121);
        when(launcher.launch(any(), any())).thenReturn(first, second);
        service.start("first");
        service.start("second");
        when(projects.findById("first")).thenReturn(Optional.empty());
        service.reap();
        verify(first).stop();
        service.close();
        verify(second).stop();
        var failure = assertThrows(ApiException.class, () -> service.start("second"));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, failure.getStatus());
        assertEquals("live_preview_stopping", failure.getCode());
    }

    @Test void failedFourthLaunchKeepsAllThreeExistingPreviews() {
        for (String id : new String[]{"first", "second", "third", "fourth"}) project(id);
        var first = process(43120);
        var second = process(43121);
        var third = process(43122);
        var failed = process(43123);
        when(failed.awaitReady(any())).thenThrow(LivePreviewProcess.unavailable("共享运行时缺少预览依赖"));
        when(launcher.launch(any(), any())).thenReturn(first, second, third, failed);
        service.start("first");
        service.start("second");
        service.start("third");
        assertThrows(ApiException.class, () -> service.start("fourth"));
        for (String id : new String[]{"first", "second", "third"}) assertEquals("ready", service.get(id).status());
        verify(first, never()).stop();
        verify(second, never()).stop();
        verify(third, never()).stop();
        verify(failed).stop();
    }

    @Test void reaperAndQueriesDoNotOverwriteStartupFailureEvenAfterProcessExit() throws Exception {
        project("first");
        var process = process(43120);
        var entered = new CountDownLatch(1);
        var finish = new CountDownLatch(1);
        when(launcher.launch(any(), any())).thenReturn(process);
        when(process.awaitReady(any())).thenAnswer(invocation -> {
            entered.countDown();
            assertTrue(finish.await(3, TimeUnit.SECONDS));
            throw LivePreviewProcess.unavailable("共享运行时缺少 @babel/parser");
        });
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var pending = executor.submit(() -> service.start("first"));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            when(process.alive()).thenReturn(false);
            now.updateAndGet(time -> time.plusSeconds(601));
            service.reap();
            assertEquals("stopped", service.get("first").status());
            verify(process, never()).stop();
            finish.countDown();
            var failure = assertThrows(java.util.concurrent.ExecutionException.class, () -> pending.get(3, TimeUnit.SECONDS));
            assertEquals("共享运行时缺少 @babel/parser", failure.getCause().getMessage());
            verify(launcher, times(1)).launch(any(), any());
        } finally { finish.countDown(); }
    }

    @Test void slowProcessStopDoesNotBlockAnotherProjectsQueryOrHeartbeat() throws Exception {
        project("first");
        project("second");
        var first = process(43120);
        var second = process(43121);
        when(launcher.launch(any(), any())).thenReturn(first, second);
        service.start("first");
        service.start("second");
        var entered = new CountDownLatch(1);
        var finish = new CountDownLatch(1);
        doAnswer(invocation -> {
            entered.countDown();
            assertTrue(finish.await(3, TimeUnit.SECONDS));
            return null;
        }).when(first).stop();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var stopping = executor.submit(() -> service.stop("first"));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            try {
                assertEquals("ready", executor.submit(() -> service.get("second")).get(1, TimeUnit.SECONDS).status());
                assertEquals("ready", executor.submit(() -> service.start("second")).get(1, TimeUnit.SECONDS).status());
            } finally { finish.countDown(); }
            stopping.get(2, TimeUnit.SECONDS);
        } finally { finish.countDown(); }
    }

    @Test void queuedLaunchIsCancelledByShutdownWithoutStartingAnotherProcess() throws Exception {
        project("first");
        project("second");
        var process = process(43120);
        var entered = new CountDownLatch(1);
        var finish = new CountDownLatch(1);
        when(launcher.launch(any(), any())).thenReturn(process);
        when(process.awaitReady(any())).thenAnswer(invocation -> {
            entered.countDown();
            assertTrue(finish.await(3, TimeUnit.SECONDS));
            return "http://127.0.0.1:43120/";
        });
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> service.start("first"));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            var second = executor.submit(() -> service.start("second"));
            service.close();
            finish.countDown();
            for (var future : java.util.List.of(first, second)) {
                var failure = assertThrows(java.util.concurrent.ExecutionException.class, () -> future.get(3, TimeUnit.SECONDS));
                assertEquals("live_preview_stopping", ((ApiException) failure.getCause()).getCode());
            }
            verify(launcher, times(1)).launch(any(), any());
        } finally { finish.countDown(); }
    }

    @Test void switchingKeepsOldPreviewsUntilNewHandshakeSucceeds() throws Exception {
        for (String id : new String[]{"first", "second", "third", "fourth"}) project(id);
        var first = process(43120);
        var second = process(43121);
        var third = process(43122);
        var fourth = process(43123);
        var entered = new CountDownLatch(1);
        var finish = new CountDownLatch(1);
        when(fourth.awaitReady(any())).thenAnswer(invocation -> {
            entered.countDown();
            assertTrue(finish.await(3, TimeUnit.SECONDS));
            return "http://127.0.0.1:43123/";
        });
        when(launcher.launch(any(), any())).thenReturn(first, second, third, fourth);
        service.start("first");
        now.updateAndGet(time -> time.plusSeconds(1));
        service.start("second");
        now.updateAndGet(time -> time.plusSeconds(1));
        service.start("third");
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var pending = executor.submit(() -> service.start("fourth"));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            assertEquals("ready", service.get("first").status());
            verify(first, never()).stop();
            now.updateAndGet(time -> time.plusSeconds(1));
            service.start("first");
            finish.countDown();
            assertEquals("ready", pending.get(3, TimeUnit.SECONDS).status());
            verify(second).stop();
            verify(first, never()).stop();
        } finally { finish.countDown(); }
    }
}
