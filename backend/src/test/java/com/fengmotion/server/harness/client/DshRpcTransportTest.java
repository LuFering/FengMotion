package com.fengmotion.server.harness.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;

class DshRpcTransportTest {
    private final ObjectMapper json = new ObjectMapper();
    private final ByteArrayOutputStream stdin = new ByteArrayOutputStream();

    private DshRpcTransport transport(String script) throws IOException {
        Process process = mock(Process.class);
        when(process.getInputStream()).thenReturn(new ByteArrayInputStream(script.getBytes(StandardCharsets.UTF_8)));
        when(process.getOutputStream()).thenReturn(stdin);
        when(process.isAlive()).thenReturn(true);
        return new DshRpcTransport(new DshProcess(process), json);
    }

    @Test
    void preservesNotificationsInterleavedWithMultipleRequestAcknowledgements() throws Exception {
        var transport = transport("""
                diagnostics that are not protocol frames

                {"method":"session.status","params":{"sessionId":"test","status":"running"}}
                {"id":99,"result":{}}
                {"id":1,"result":{"serverInfo":{"name":"sdk"}}}
                {"method":"session.event","params":{"sessionId":"test","event":{"type":"turn/start"}}}
                {"id":2,"result":{}}
                {"method":"session.status","params":{"sessionId":"test","status":"idle"}}
                """);

        assertEquals("sdk", transport.request("initialize", json.createObjectNode(), Duration.ofSeconds(1))
                .path("serverInfo").path("name").asText());
        transport.request("session/prompt", json.createObjectNode().put("sessionId", "test"), Duration.ofSeconds(1));

        assertEquals("running", transport.pollNotification().path("params").path("status").asText());
        assertEquals("turn/start", transport.pollNotification().path("params").path("event").path("type").asText());
        assertEquals("idle", transport.pollNotification().path("params").path("status").asText());
        assertNull(transport.pollNotification());
        var requests = stdin.toString(StandardCharsets.UTF_8).lines().toList();
        assertEquals(2, requests.size());
        assertEquals(1, json.readTree(requests.getFirst()).path("id").asInt());
        assertEquals("session/prompt", json.readTree(requests.getLast()).path("method").asText());
        assertEquals(2, json.readTree(requests.getLast()).path("id").asInt());
    }

    @Test
    void propagatesRpcErrorWithoutDiscardingEarlierNotification() throws Exception {
        var transport = transport("""
                {"method":"session.status","params":{"status":"running"}}
                {"id":1,"error":{"code":-32000,"message":"session unavailable"}}
                """);

        var failure = assertThrows(IOException.class,
                () -> transport.request("session/resume", null, Duration.ofSeconds(1)));

        assertTrue(failure.getMessage().contains("-32000 session unavailable"));
        assertEquals("running", transport.pollNotification().path("params").path("status").asText());
    }

    @Test
    void reportsClosedStdoutWhileWaitingForAcknowledgement() throws Exception {
        var transport = transport("malformed frame\n");
        var failure = assertThrows(IOException.class,
                () -> transport.request("initialize", null, Duration.ofSeconds(1)));
        assertTrue(failure.getMessage().contains("stdout 已关闭"));
    }

    @Test
    void preservesInterruptWhenWaitingForPluginFrames() throws Exception {
        var transport = transport("");
        try {
            Thread.currentThread().interrupt();
            assertThrows(IOException.class, () -> transport.awaitStreamFrame(1_000_000));
            assertTrue(Thread.currentThread().isInterrupted());
        } finally {
            Thread.interrupted();
        }
    }
}
