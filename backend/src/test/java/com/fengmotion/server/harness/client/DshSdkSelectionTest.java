package com.fengmotion.server.harness.client;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import org.junit.jupiter.api.Test;
import com.fasterxml.jackson.databind.ObjectMapper;

class DshSdkSelectionTest {
    @Test
    void initializeSendsSelectedRouteAndOptionalEffort() throws Exception {
        var json = new ObjectMapper();
        for (String effort : new String[] {"high", null}) {
            Process process = mock(Process.class);
            var sent = new ByteArrayOutputStream();
            when(process.getOutputStream()).thenReturn(sent);
            when(process.getInputStream()).thenReturn(new ByteArrayInputStream(
                    "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"serverInfo\":{\"name\":\"dsh\"}}}\n".getBytes(StandardCharsets.UTF_8)));
            var driver = new DshSdkSession(new DshProcess(process), json, "route", "model-b", effort);
            driver.initialize("/tmp", Duration.ofSeconds(1));
            var frame = json.readTree(sent.toString(StandardCharsets.UTF_8));
            assertEquals("initialize", frame.path("method").asText());
            assertEquals("route", frame.path("params").path("provider").asText());
            assertEquals("model-b", frame.path("params").path("model").asText());
            assertEquals(effort != null, frame.path("params").has("reasoningEffort"));
            if (effort != null) assertEquals(effort, frame.path("params").path("reasoningEffort").asText());
        }
    }
}
