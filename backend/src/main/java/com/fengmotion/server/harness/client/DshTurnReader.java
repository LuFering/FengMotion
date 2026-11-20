package com.fengmotion.server.harness.client;

import java.io.IOException;
import java.time.Duration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.harness.client.DshSdkSession.Listener;
import com.fengmotion.server.harness.client.DshSdkSession.Outcome;

final class DshTurnReader {
    private static final long STREAM_POLL_NANOS = 5_000_000;
    private final DshRpcTransport transport;
    private final DshTurnEvents events;
    private final Duration heartbeatInterval;

    DshTurnReader(DshRpcTransport transport, DshTurnEvents events, Duration heartbeatInterval) {
        this.transport = transport;
        this.events = events;
        this.heartbeatInterval = heartbeatInterval;
    }

    Outcome read(Listener listener, Duration timeout, Duration foreground, Runnable onHandoff) throws IOException {
        long start = System.nanoTime();
        long deadline = start + timeout.toNanos();
        long foregroundDeadline = foreground == null ? Long.MAX_VALUE : start + foreground.toNanos();
        boolean handedOff = false;
        Listener sink = new SilentListener();
        long lastHeartbeat = start;
        while (true) {
            if (!handedOff && System.nanoTime() > foregroundDeadline) {
                handedOff = true;
                if (onHandoff != null) {
                    try { onHandoff.run(); } catch (RuntimeException ignored) { }
                }
            }
            Listener active = handedOff && !listener.collectAfterHandoff() ? sink : listener;
            if (System.nanoTime() - lastHeartbeat >= heartbeatInterval.toNanos()) {
                lastHeartbeat = System.nanoTime();
                active.onHeartbeat();
            }
            if (System.nanoTime() > deadline) throw new IOException("等待 Agent 完成超时（" + timeout.toSeconds() + " 秒）");
            drain(active);
            JsonNode frame = transport.pollNotification();
            if (frame == null) {
                if (!transport.isAlive()) throw new IOException("DSH 子进程已退出，未收到 idle 通知");
                JsonNode pending = transport.awaitStreamFrame(Math.min(Math.max(0, deadline - System.nanoTime()), STREAM_POLL_NANOS));
                if (pending != null) events.stream(pending, active);
                continue;
            }
            if (frame.has("id") && !frame.has("method")) continue;
            if (events.notification(frame, active, listener)) {
                drain(active);
                active.onIdle();
                return events.outcome();
            }
        }
    }

    private void drain(Listener listener) {
        JsonNode frame;
        while ((frame = transport.pollStreamFrame()) != null) events.stream(frame, listener);
    }

    private static final class SilentListener implements Listener {
        @Override
        public void onTurnStarted(int turn) {
        }

        @Override
        public void onStepStarted(int turn, int step) {
        }

        @Override
        public void onToolCall(String callId, String name, String arguments) {
        }

        @Override
        public void onToolResult(String callId, String text, boolean isError) {
        }

        @Override
        public void onTextDelta(String text) {
        }

        @Override
        public void onThinkingDelta(String text) {
        }

        @Override
        public void onAssistantMessage(String text, String reasoning) {
        }

        @Override
        public void onIdle() {
        }

        @Override
        public void onTurnEnded(boolean failed, String failure) {
        }
    }
}
