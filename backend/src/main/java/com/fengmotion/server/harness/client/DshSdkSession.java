package com.fengmotion.server.harness.client;

import java.io.IOException;
import java.time.Duration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

public class DshSdkSession {

    static final Duration HEARTBEAT_INTERVAL = Duration.ofSeconds(15);

    Duration heartbeatInterval = HEARTBEAT_INTERVAL;

    public static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(180);

    public interface Listener {

        default void onHeartbeat() { }

        void onTurnStarted(int turn);

        void onStepStarted(int turn, int step);

        void onToolCall(String callId, String name, String arguments);

        void onToolResult(String callId, String text, boolean isError);

        void onTextDelta(String text);

        default void onTextDelta(int turn, int step, String attempt, String text) { onTextDelta(text); }

        void onThinkingDelta(String text);

        void onAssistantMessage(String text, String reasoning);

        default void onAssistantMessage(int turn, int step, String text, String reasoning) { onAssistantMessage(text, reasoning); }

        default boolean collectAfterHandoff() { return false; }

        default void onSessionTitle(String title) {
            // 默认忽略
        }

        default void onUsage(TokenUsage usage) {
            // 默认忽略
        }

        record TokenUsage(long inputTokens, long outputTokens, long cacheReadTokens,
                          long cacheWriteTokens, long totalTokens) {
        }

        default void onContextWindow(long contextWindow) {
            // 默认忽略
        }

        default void onToolsTokens(long toolsTokens) {
            // 默认忽略
        }

        default void onContextBreakdown(ContextBreakdown breakdown) {
            // 默认忽略
        }

        default void onJob(JobInfo job) {
            // 默认忽略
        }

        default void onDeliverables(java.util.List<Deliverable> files) {
            // 默认忽略
        }

        record Deliverable(String path, String description) {
        }

        record ContextBreakdown(long systemTokens, long memoryTokens, long filesTokens,
                                long resultsTokens, long chatTokens) {
        }

        record JobInfo(String jobId, String kind, String label, String status,
                       long durationMs, String detail) {
        }

        void onTurnEnded(boolean failed, String reason);

        default void onDiagnostic(String kind, String detail) {
            // 默认忽略
        }

        void onIdle();
    }

    public record Outcome(String text, String reasoning, boolean failed, String failure) {
    }

    public record InlineImage(String base64, String mimeType) {

        private static final java.util.Set<String> ALLOWED =
                java.util.Set.of("image/png", "image/jpeg", "image/webp", "image/gif");

        public static boolean isSupported(String mimeType) {
            return mimeType != null && ALLOWED.contains(mimeType.toLowerCase(java.util.Locale.ROOT));
        }
    }

    private final DshRpcTransport transport;
    private final ObjectMapper json;
    private final String provider;
    private final String model;
    private final String reasoningEffort;
    private final ContextBreakdownMeter breakdownMeter = new ContextBreakdownMeter();
    private String cwd;

    public DshSdkSession(DshProcess channel, ObjectMapper json, String provider, String model) {
        this(channel, json, provider, model, null);
    }

    public DshSdkSession(DshProcess channel, ObjectMapper json, String provider, String model,
                         String reasoningEffort) {
        this.transport = new DshRpcTransport(channel, json);
        this.json = json;
        this.provider = provider;
        this.model = model;
        this.reasoningEffort = reasoningEffort;
    }

    public void acceptStreamFrame(JsonNode frame) {
        transport.acceptStreamFrame(frame);
    }

    public String initialize(String cwd, Duration timeout) throws IOException {
        this.cwd = cwd;
        ObjectNode params = json.createObjectNode();
        params.put("cwd", cwd);
        params.put("provider", provider);
        params.put("model", model);
        if (reasoningEffort != null) {
            params.put("reasoningEffort", reasoningEffort);
        }
        JsonNode result = transport.request("initialize", params, timeout);
        JsonNode serverInfo = result.path("serverInfo");
        String name = serverInfo.path("name").asText("");
        if (name.isEmpty()) {
            throw new IOException("initialize 响应缺少 serverInfo.name");
        }
        return name;
    }

    public void resume(String sessionId, Duration timeout) throws IOException {
        ObjectNode params = json.createObjectNode();
        params.put("sessionId", sessionId);
        transport.request("session/resume", params, timeout);
    }

    public Outcome prompt(String sessionId, String text, Listener listener, Duration timeout)
            throws IOException {
        return prompt(sessionId, text, java.util.List.of(), listener, timeout);
    }

    public Outcome prompt(String sessionId, String text, java.util.List<InlineImage> images,
                          Listener listener, Duration timeout)
            throws IOException {
        return prompt(sessionId, text, images, listener, timeout, null, null);
    }

    public Outcome prompt(String sessionId, String text, java.util.List<InlineImage> images,
                          Listener listener, Duration timeout,
                          Duration foreground, Runnable onHandoff)
            throws IOException {
        ObjectNode params = json.createObjectNode();
        params.put("sessionId", sessionId);
        ArrayNode blocks = params.putArray("contentBlocks");
        ObjectNode block = json.createObjectNode();
        block.put("type", "text");
        block.put("text", text);
        blocks.add(block);

        if (images != null) {
            for (InlineImage image : images) {
                ObjectNode imageBlock = json.createObjectNode();
                imageBlock.put("type", "image");
                imageBlock.put("data", image.base64());
                imageBlock.put("mimeType", image.mimeType());
                blocks.add(imageBlock);
            }
        }
        transport.request("session/prompt", params, timeout);
        return new DshTurnReader(transport, new DshTurnEvents(sessionId, cwd, breakdownMeter), heartbeatInterval)
                .read(listener, timeout, foreground, onHandoff);
    }

}
