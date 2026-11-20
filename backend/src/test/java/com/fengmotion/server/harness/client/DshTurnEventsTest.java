package com.fengmotion.server.harness.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

class DshTurnEventsTest {
    private final ObjectMapper json = new ObjectMapper();
    private final DshTurnEvents events = new DshTurnEvents("test", null, new ContextBreakdownMeter());
    private final DshSdkSession.Listener listener = mock(DshSdkSession.Listener.class);

    private JsonNode event(String type, String data) throws Exception {
        return json.readTree("{\"method\":\"session.event\",\"params\":{\"sessionId\":\"test\",\"event\":{\"type\":\""
                + type + "\",\"data\":" + data + "}}}");
    }

    @Test
    void ignoresProtocolAndPluginFramesFromOtherSessions() throws Exception {
        var other = event("tool/call", "{\"callId\":\"other\",\"name\":\"bash\"}");
        ((com.fasterxml.jackson.databind.node.ObjectNode) other.path("params")).put("sessionId", "other");
        assertFalse(events.notification(other, listener, listener));
        events.stream(json.readTree("""
                {"method":"stream/delta","params":{"sessionId":"other","kind":"thinking","text":"foreign"}}
                """), listener);
        assertFalse(events.notification(json.readTree("""
                {"method":"session.status","params":{"sessionId":"other","status":"idle"}}
                """), listener, listener));

        assertEquals("", events.outcome().reasoning());
        verifyNoInteractions(listener);
    }

    @Test
    void deduplicatesReasoningFromDeltaBlockAndCanonicalMessage() throws Exception {
        events.stream(json.readTree("""
                {"method":"stream/delta","params":{"kind":"thinking","text":"先检查"}}
                """), listener);
        events.stream(json.readTree("""
                {"method":"stream/delta","params":{"kind":"block_end","blockType":"reasoning","text":"先检查"}}
                """), listener);
        events.stream(json.readTree("""
                {"method":"stream/delta","params":{"kind":"block_end","blockType":"reasoning","text":"再修改"}}
                """), listener);
        events.notification(event("assistant/message", """
                {"turn":1,"step":2,"message":{"content":[
                  {"type":"text","text":"修改完成"},
                  {"type":"reasoning","text":"先检查再修改"}]}}
                """), listener, listener);

        assertEquals("先检查再修改", events.outcome().reasoning());
        assertEquals("修改完成", events.outcome().text());
        verify(listener).onThinkingDelta("先检查");
        verify(listener).onThinkingDelta("再修改");
    }

    @Test
    void preservesUnknownUsageAndTaggedTextDelta() throws Exception {
        events.stream(json.readTree("""
                {"method":"stream/delta","params":{"sessionId":"test","kind":"text","turn":2,"step":3,"attemptId":"attempt","text":"开始修改"}}
                """), listener);
        events.notification(event("assistant/message", "{\"message\":{\"content\":[]}}"), listener, listener);

        verify(listener).onTextDelta(2, 3, "attempt", "开始修改");
        verify(listener).onUsage(new DshSdkSession.Listener.TokenUsage(-1, -1, -1, -1, -1));
    }

    @Test
    void retainsStructuredFailureInOutcome() throws Exception {
        events.notification(event("turn/end", """
                {"reason":{"kind":"error","error":{"code":"limit","message":"quota exceeded"}}}
                """), listener, listener);

        assertTrue(events.outcome().failed());
        assertEquals("limit: quota exceeded", events.outcome().failure());
        verify(listener).onTurnEnded(true, "limit: quota exceeded");
    }
}
