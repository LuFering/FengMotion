package com.fengmotion.server.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.chat.domain.ChatMessage;

class ChatSseWriterTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void completedFramePreservesPersistedTimelineAndMetadataWhenHttpFlushFails() throws Exception {
        var tools = json.readTree("[{\"callId\":\"call\",\"textOffset\":3,\"order\":2,\"done\":true}]");
        var todos = json.readTree("[{\"content\":\"渲染\",\"status\":\"completed\"}]");
        var usage = json.readTree("{\"totalTokens\":42,\"breakdown\":{\"filesTokens\":5}}");
        var deliverables = json.readTree("[{\"path\":\"out.mp4\"}]");
        var reasoning = json.readTree("[{\"textOffset\":0,\"order\":1,\"text\":\"检查\"}]");
        var saved = new ChatMessage("message", "session", 7, "assistant", "已完成", null, null, null,
                tools, "检查", todos, usage, deliverables, reasoning, Instant.parse("2026-11-19T01:00:00Z"));
        AtomicInteger flushes = new AtomicInteger();
        var writer = new ChatSseWriter(json, () -> () -> {
            flushes.incrementAndGet();
            throw new IllegalStateException("disconnected");
        });
        var output = new StringWriter();

        writer.writeCompleted(new PrintWriter(output), saved);

        var lines = output.toString().lines().toList();
        assertEquals("event: completed", lines.getFirst());
        var frame = json.readTree(lines.get(1).substring(6));
        var body = frame.path("message");
        assertEquals("completed", frame.path("type").asText());
        assertEquals(saved.id(), body.path("id").asText());
        assertEquals(saved.sessionId(), body.path("sessionId").asText());
        assertEquals(saved.role(), body.path("role").asText());
        assertEquals(saved.text(), body.path("text").asText());
        assertEquals(saved.reasoning(), body.path("reasoning").asText());
        assertEquals(tools, body.path("toolCalls"));
        assertEquals(reasoning, body.path("reasoningSegments"));
        assertEquals(todos, body.path("todos"));
        assertEquals(usage, body.path("usage"));
        assertEquals(deliverables, body.path("deliverables"));
        assertEquals(saved.createdAt().toString(), body.path("createdAt").asText());
        assertFalse(body.has("seq"));
        assertEquals(1, flushes.get());
    }

    @Test
    void detachedWriterDoesNotFlushAndEmptyMetadataRemainsAbsent() throws Exception {
        var writer = new ChatSseWriter(json, () -> {
            throw new AssertionError("detached output must not flush");
        });
        writer.writeEnd(null);

        var output = new StringWriter();
        writer = new ChatSseWriter(json, () -> null);
        writer.writeCompleted(new PrintWriter(output), new ChatMessage("message", "session", 1,
                "assistant", "完成", null, null, null, null, Instant.now()));
        var frame = json.readTree(output.toString().lines().filter(line -> line.startsWith("data: "))
                .findFirst().orElseThrow().substring(6));
        assertNull(frame.path("message").get("reasoningSegments"));
        assertNull(frame.path("message").get("toolCalls"));
        assertNull(frame.path("message").get("usage"));
    }
}
