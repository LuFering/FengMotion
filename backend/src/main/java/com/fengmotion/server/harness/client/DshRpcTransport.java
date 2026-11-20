package com.fengmotion.server.harness.client;

import java.io.BufferedReader;
import java.io.IOException;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

final class DshRpcTransport {
    private final DshProcess channel;
    private final BufferedReader stdout;
    private final ObjectMapper json;
    private final Deque<JsonNode> pendingNotifications = new ArrayDeque<>();
    private final BlockingQueue<JsonNode> streamFrames = new LinkedBlockingQueue<>();

    DshRpcTransport(DshProcess channel, ObjectMapper json) {
        this.channel = channel;
        this.stdout = channel.openStdout();
        this.json = json;
    }

    JsonNode request(String method, JsonNode params, Duration timeout) throws IOException {
        long id = channel.nextRequestId();
        channel.sendRequest(id, method, params);
        return awaitResponse(id, timeout);
    }

    void acceptStreamFrame(JsonNode frame) { streamFrames.add(frame); }
    JsonNode pollStreamFrame() { return streamFrames.poll(); }
    boolean isAlive() { return channel.isAlive(); }

    JsonNode pollNotification() throws IOException {
        if (!pendingNotifications.isEmpty()) return pendingNotifications.pollFirst();
        while (stdout.ready()) {
            String line = DshProcess.readLine(stdout);
            if (line == null) throw new IOException("DSH 子进程 stdout 已关闭，未收到 idle 通知");
            if (line.isBlank()) continue;
            JsonNode frame = parseFrame(line);
            if (frame != null) return frame;
        }
        return null;
    }

    JsonNode awaitStreamFrame(long nanos) throws IOException {
        if (nanos <= 0) return null;
        try { return streamFrames.poll(Math.max(1, nanos), TimeUnit.NANOSECONDS); }
        catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IOException("读取被中断", interrupted);
        }
    }

    private JsonNode awaitResponse(long id, Duration timeout) throws IOException {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (true) {
            if (System.nanoTime() > deadline) {
                throw new IOException("等待 JSON-RPC 响应超时（id=" + id + "）");
            }
            String line = DshProcess.readLine(stdout);
            if (line == null) {
                throw new IOException("DSH 子进程 stdout 已关闭（等待 id=" + id + "）");
            }
            if (line.isBlank()) {
                continue;
            }
            JsonNode frame = parseFrame(line);
            if (frame == null) {
                continue;
            }
            if (!frame.has("id") || frame.path("id").asLong(-1) != id) {
                // 不是目标响应：若是通知帧就缓存下来，交给事件流处理，不能丢。
                if (frame.has("method")) {
                    pendingNotifications.addLast(frame);
                }
                continue;
            }
            JsonNode error = frame.path("error");
            if (!error.isMissingNode() && !error.isNull()) {
                throw new IOException("JSON-RPC 错误："
                        + error.path("code").asInt()
                        + " " + error.path("message").asText(""));
            }
            return frame.path("result");
        }
    }

    private JsonNode parseFrame(String line) {
        try {
            return json.readTree(line);
        } catch (IOException malformed) {
            return null;
        }
    }
}
