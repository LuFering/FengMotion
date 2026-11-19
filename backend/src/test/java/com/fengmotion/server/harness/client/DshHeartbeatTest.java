package com.fengmotion.server.harness.client;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.ByteArrayOutputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 工具调用期间 DSH 不发任何事件，回复流也要按间隔发心跳。
 *
 * <p>实测：一条 bash 卡了 60 秒，回复流 45 秒没有字节，前端按断线重连，进而触发了第二轮。</p>
 */
class DshHeartbeatTest {

    private static String event(String type, String data) {
        return "{\"method\":\"session.event\",\"params\":{\"sessionId\":\"test\",\"event\":{\"type\":\"" + type + "\",\"data\":" + data + "}}}\n";
    }

    @Test
    void emitsHeartbeatsWhileAToolRunsSilently() throws Exception {
        PipedOutputStream feed = new PipedOutputStream();
        PipedInputStream stdout = new PipedInputStream(feed, 1 << 16);
        Process process = mock(Process.class);
        when(process.getInputStream()).thenReturn(stdout);
        when(process.getOutputStream()).thenReturn(new ByteArrayOutputStream());
        when(process.isAlive()).thenReturn(true);

        var driver = new DshSdkSession(new DshProcess(process), new ObjectMapper(), "route", "model");
        driver.heartbeatInterval = Duration.ofMillis(50);

        Thread writer = new Thread(() -> {
            try {
                feed.write(("{\"id\":1,\"result\":{}}\n"
                        + event("turn/start", "{\"turn\":1}")
                        + event("tool/call", "{\"callId\":\"slow\",\"name\":\"bash\"}")).getBytes(StandardCharsets.UTF_8));
                feed.flush();
                Thread.sleep(400); // 工具在跑，DSH 一帧都不发
                feed.write((event("tool/result", "{\"message\":{\"toolCallId\":\"slow\",\"content\":[]}}")
                        + event("turn/end", "{\"reason\":{\"kind\":\"completed\"}}")
                        + "{\"method\":\"session.status\",\"params\":{\"sessionId\":\"test\",\"status\":\"idle\"}}\n")
                        .getBytes(StandardCharsets.UTF_8));
                feed.close();
            } catch (Exception ignored) {
                // 读端提前结束时写入失败，断言会给出结果
            }
        });
        writer.start();

        AtomicInteger heartbeats = new AtomicInteger();
        DshSdkSession.Listener listener = new DshSdkSession.Listener() {
            @Override public void onHeartbeat() { heartbeats.incrementAndGet(); }
            @Override public void onTurnStarted(int turn) { }
            @Override public void onStepStarted(int turn, int step) { }
            @Override public void onTextDelta(String text) { }
            @Override public void onThinkingDelta(String text) { }
            @Override public void onAssistantMessage(String text, String reasoning) { }
            @Override public void onToolCall(String id, String name, String args) { }
            @Override public void onToolResult(String id, String text, boolean error) { }
            @Override public void onTurnEnded(boolean failed, String reason) { }
            @Override public void onIdle() { }
        };
        var outcome = driver.prompt("test", "检查", listener, Duration.ofSeconds(5));
        writer.join(2000);

        assertFalse(outcome.failed());
        assertTrue(heartbeats.get() >= 3, "400ms 的静默期里按 50ms 间隔应至少发 3 次心跳，实际 " + heartbeats.get());
    }
}
