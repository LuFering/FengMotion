package com.fengmotion.server.harness.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

class DshTurnReaderTest {
    private final ObjectMapper json = new ObjectMapper();
    private final DshRpcTransport transport = mock(DshRpcTransport.class);
    private final DshSdkSession.Listener listener = mock(DshSdkSession.Listener.class);
    private final DshTurnReader reader = new DshTurnReader(transport,
            new DshTurnEvents("test", null, new ContextBreakdownMeter()), Duration.ofSeconds(15));

    private JsonNode event(String type, String data) throws Exception {
        return json.readTree("{\"method\":\"session.event\",\"params\":{\"sessionId\":\"test\",\"event\":{\"type\":\""
                + type + "\",\"data\":" + data + "}}}");
    }

    private JsonNode idle() throws Exception {
        return json.readTree("{\"method\":\"session.status\",\"params\":{\"sessionId\":\"test\",\"status\":\"idle\"}}");
    }

    @Test
    void handoffSuppressesForegroundEventsButPreservesExistingMetadataCallbacks() throws Exception {
        when(transport.pollNotification()).thenReturn(
                event("session/title", "{\"title\":\"后台任务\"}"),
                event("tool/call", "{\"callId\":\"call\",\"name\":\"bash\"}"),
                event("assistant/message", "{\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"完成\"}]},\"usage\":{\"totalTokens\":12}}"),
                event("job/registered", "{\"jobId\":\"job\",\"kind\":\"bash\",\"label\":\"渲染\"}"),
                event("deliverables/presented", "{\"files\":[{\"path\":\"out.mp4\"}]}"),
                event("compaction/end", "{}"),
                event("turn/end", "{\"reason\":{\"kind\":\"completed\"}}"), idle());
        AtomicInteger handoffs = new AtomicInteger();

        var outcome = reader.read(listener, Duration.ofSeconds(1), Duration.ofNanos(-1), handoffs::incrementAndGet);

        assertEquals(1, handoffs.get());
        assertEquals("完成", outcome.text());
        assertFalse(outcome.failed());
        verify(listener, never()).onToolCall(anyString(), anyString(), anyString());
        verify(listener, never()).onAssistantMessage(anyInt(), anyInt(), anyString(), anyString());
        verify(listener, never()).onIdle();
        verify(listener).onSessionTitle("后台任务");
        verify(listener).onUsage(new DshSdkSession.Listener.TokenUsage(-1, -1, -1, -1, 12));
        verify(listener).onJob(new DshSdkSession.Listener.JobInfo("job", "bash", "渲染", "running", -1, null));
        verify(listener).onDeliverables(List.of(new DshSdkSession.Listener.Deliverable("out.mp4", null)));
        verify(listener).onDiagnostic("compaction", "上下文压缩完成");
    }

    @Test
    void collectingListenerKeepsReceivingEventsEvenWhenHandoffCallbackFails() throws Exception {
        when(listener.collectAfterHandoff()).thenReturn(true);
        when(transport.pollNotification()).thenReturn(
                event("tool/call", "{\"callId\":\"call\",\"name\":\"bash\",\"arguments\":\"{}\"}"),
                event("turn/end", "{\"reason\":{\"kind\":\"completed\"}}"), idle());
        AtomicInteger handoffs = new AtomicInteger();

        var outcome = reader.read(listener, Duration.ofSeconds(1), Duration.ofNanos(-1), () -> {
            handoffs.incrementAndGet();
            throw new IllegalStateException("connection closed");
        });

        assertFalse(outcome.failed());
        assertEquals(1, handoffs.get());
        verify(listener).onToolCall("call", "bash", "{}");
        verify(listener).onContextBreakdown(any());
        verify(listener).onTurnEnded(false, null);
        verify(listener).onIdle();
    }

    @Test
    void reportsProcessExitBeforeIdle() throws Exception {
        when(transport.isAlive()).thenReturn(false);
        var failure = assertThrows(IOException.class,
                () -> reader.read(listener, Duration.ofSeconds(1), null, null));
        assertTrue(failure.getMessage().contains("子进程已退出"));
    }

    @Test
    void respectsHardDeadline() {
        var failure = assertThrows(IOException.class,
                () -> reader.read(listener, Duration.ZERO, null, null));
        assertTrue(failure.getMessage().contains("等待 Agent 完成超时"));
    }
}
