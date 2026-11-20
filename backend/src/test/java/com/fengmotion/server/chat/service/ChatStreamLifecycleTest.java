package com.fengmotion.server.chat.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatMessageRepository;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.harness.client.DshLauncher;
import com.fengmotion.server.harness.client.DshProcess;
import com.fengmotion.server.harness.config.HarnessProperties;
import com.fengmotion.server.harness.service.HarnessService;

class ChatStreamLifecycleTest {
    @Test
    void rejectingDuplicateTurnKeepsOriginalProcessRegisteredAndStopScopedToSession() throws Exception {
        var harness = mock(HarnessService.class);
        when(harness.isAvailable()).thenReturn(true);
        var launcher = mock(DshLauncher.class);
        var running = mock(DshProcess.class);
        var rejected = mock(DshProcess.class);
        when(launcher.startSdk()).thenReturn(running, rejected);
        var sessions = mock(ChatSessionRepository.class);
        when(sessions.findById("session")).thenReturn(Optional.of(
                new ChatSession("session", null, "测试", Instant.now(), Instant.now())));
        var messages = mock(ChatMessageRepository.class);
        var service = new ChatStreamService(harness, null, null, null, new HarnessProperties(),
                launcher, sessions, messages, null, new ObjectMapper(), null);
        when(running.openStdout()).thenReturn(new BufferedReader(new InputStreamReader(new ByteArrayInputStream("""
                {"id":1,"result":{"serverInfo":{"name":"test-sdk"}}}
                {"id":2,"result":{}}
                """.getBytes(StandardCharsets.UTF_8)), StandardCharsets.UTF_8)));
        AtomicLong requestIds = new AtomicLong();
        when(running.nextRequestId()).thenAnswer(invocation -> requestIds.incrementAndGet());
        AtomicBoolean alive = new AtomicBoolean(true);
        when(running.isAlive()).thenAnswer(invocation -> alive.get());
        doAnswer(invocation -> { alive.set(false); return null; }).when(running).close();
        CountDownLatch prompted = new CountDownLatch(1);
        doAnswer(invocation -> {
            if ("session/prompt".equals(invocation.getArgument(1))) prompted.countDown();
            return null;
        }).when(running).sendRequest(anyLong(), anyString(), any());
        var output = new StringWriter();

        try (var executor = Executors.newSingleThreadExecutor()) {
            var turn = executor.submit(() -> service.stream("session", new PrintWriter(output), "检查", () -> { }));
            try {
                assertTrue(prompted.await(2, TimeUnit.SECONDS));
                var duplicate = new StringWriter();
                service.stream("session", new PrintWriter(duplicate), "重复", () -> { });
                assertTrue(duplicate.toString().contains("session_busy"));
                verify(rejected).close();
                verify(running, never()).close();
                assertFalse(service.stop("other-session"));
                verify(running, never()).close();
                assertTrue(service.stop("session"));
                turn.get(2, TimeUnit.SECONDS);
                assertTrue(output.toString().contains("event: stopped"));
                assertTrue(output.toString().contains("event: end"));
                assertFalse(output.toString().contains("event: error"));
                assertFalse(output.toString().contains("event: completed"));
                assertFalse(service.stop("session"));
                verify(messages, never()).append(any());
            } finally {
                alive.set(false);
                turn.get(2, TimeUnit.SECONDS);
            }
        }
    }
}
