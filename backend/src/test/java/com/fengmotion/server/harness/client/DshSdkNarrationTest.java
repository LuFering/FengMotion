package com.fengmotion.server.harness.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DshSdkNarrationTest {
    private final ObjectMapper json = new ObjectMapper();

    private String event(String type, String data) {
        return "{\"method\":\"session.event\",\"params\":{\"sessionId\":\"test\",\"event\":{\"type\":\"" + type + "\",\"data\":" + data + "}}}\n";
    }

    private static final class Recording implements DshSdkSession.Listener {
        final List<String> events = new ArrayList<>();
        public void onTurnStarted(int turn) {}
        public void onStepStarted(int turn, int step) { events.add("step:" + step); }
        public void onTextDelta(String text) { events.add("delta:" + text); }
        public void onThinkingDelta(String text) {}
        public void onAssistantMessage(String text, String reasoning) { events.add("text:" + text); }
        public void onToolCall(String id, String name, String args) { events.add("tool:" + name); }
        public void onToolResult(String id, String text, boolean error) { events.add("result:" + id); }
        public void onTurnEnded(boolean failed, String reason) {}
        public void onIdle() {}
    }

    @Test void durableStageMessageArrivesBeforeTheToolsAndSurvivesWithoutStreamingPlugin() throws Exception {
        String script = "{\"id\":1,\"result\":{}}\n"
                + event("turn/start", "{\"turn\":1}")
                + event("step/start", "{\"turn\":1,\"step\":1}")
                + event("assistant/message", "{\"turn\":1,\"step\":1,\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"先检查文件。\"}]}}")
                + event("tool/call", "{\"callId\":\"one\",\"name\":\"read\",\"arguments\":\"{}\"}")
                + event("tool/result", "{\"message\":{\"toolCallId\":\"one\",\"content\":[]}}")
                + event("step/start", "{\"turn\":1,\"step\":2}")
                + event("assistant/message", "{\"turn\":1,\"step\":2,\"message\":{\"content\":[]}}")
                + event("tool/call", "{\"callId\":\"two\",\"name\":\"bash\"}")
                + event("step/start", "{\"turn\":1,\"step\":3}")
                + event("assistant/message", "{\"turn\":1,\"step\":3,\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"已确认，开始修改。\"}]}}")
                + event("turn/end", "{\"reason\":{\"kind\":\"completed\"}}")
                + "{\"method\":\"session.status\",\"params\":{\"sessionId\":\"test\",\"status\":\"idle\"}}\n";
        Process process = mock(Process.class);
        when(process.getInputStream()).thenReturn(new ByteArrayInputStream(script.getBytes(StandardCharsets.UTF_8)));
        when(process.getOutputStream()).thenReturn(new ByteArrayOutputStream());
        when(process.isAlive()).thenReturn(true);
        var driver = new DshSdkSession(new DshProcess(process), json, "route", "model");
        JsonNode wrongSession = json.readTree("{\"method\":\"stream/delta\",\"params\":{\"sessionId\":\"other\",\"kind\":\"text\",\"text\":\"其他会话不可见\"}}");
        driver.acceptStreamFrame(wrongSession);
        Recording listener = new Recording();
        var outcome = driver.prompt("test", "检查", listener, Duration.ofSeconds(2));
        assertFalse(outcome.failed());
        assertEquals(List.of("step:1", "text:先检查文件。", "tool:read", "result:one", "step:2", "text:", "tool:bash", "step:3", "text:已确认，开始修改。"), listener.events);
    }
}
