package com.fengmotion.server.chat.service;

import java.io.PrintWriter;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.harness.client.DshSdkSession;

final class ChatReplyListener implements DshSdkSession.Listener {
    @Override public void onHeartbeat() { sse.writeFrame(out, "heartbeat", json.createObjectNode().put("type", "heartbeat")); }
    private final ObjectMapper json;
    private final ChatSseWriter sse;
    private final Consumer<String> titleChanged;
    private PrintWriter out;
    final DshTurnText publicText;

    private String lastPhase;

    private final String pendingMessageId = "pending-" + UUID.randomUUID();

    private final StringBuilder reasoningStreamed = new StringBuilder();
    private final StringBuilder plainText = new StringBuilder();

    private final List<ObjectNode> toolCalls = new java.util.ArrayList<>();

    private final TurnTimeline timeline = new TurnTimeline();

    private boolean thinkingStreamedThisStep;

    private com.fasterxml.jackson.databind.node.ArrayNode latestTodos;

    private long sumInput = -1;
    private long sumOutput = -1;
    private long sumCacheRead = -1;
    private long sumTotal = -1;
    private long lastPrompt = -1;
    private long toolsTokens = -1;
    private long contextWindow = -1;

    private com.fasterxml.jackson.databind.node.ObjectNode contextBreakdown;

    private final java.util.Map<String, com.fasterxml.jackson.databind.node.ObjectNode> deliverables
            = new java.util.LinkedHashMap<>();

    ChatReplyListener(PrintWriter out, boolean ordered, ObjectMapper json,
                      ChatSseWriter sse, Consumer<String> titleChanged) {
        this.json = json;
        this.sse = sse;
        this.titleChanged = titleChanged;
        this.out = out;
        this.publicText = ordered ? new DshTurnText((chunk, replaceFrom) -> sse.writeDelta(this.out, pendingMessageId, chunk, replaceFrom)) : null;
    }

    void detach() { out = null; }
    @Override public boolean collectAfterHandoff() { return publicText != null; }

    com.fasterxml.jackson.databind.node.ArrayNode collectedTodos() {
        return latestTodos;
    }

    com.fasterxml.jackson.databind.node.ArrayNode collectedDeliverables() {
        if (deliverables.isEmpty()) {
            return null;
        }
        com.fasterxml.jackson.databind.node.ArrayNode array = json.createArrayNode();
        deliverables.values().forEach(array::add);
        return array;
    }

    com.fasterxml.jackson.databind.node.ObjectNode collectedUsage() {
        if (sumInput < 0 && sumOutput < 0 && sumTotal < 0 && contextBreakdown == null) {
            return null;
        }
        com.fasterxml.jackson.databind.node.ObjectNode node = json.createObjectNode();
        if (sumInput >= 0) node.put("inputTokens", sumInput);
        if (sumOutput >= 0) node.put("outputTokens", sumOutput);
        if (sumCacheRead >= 0) node.put("cacheReadTokens", sumCacheRead);
        if (sumTotal >= 0) node.put("totalTokens", sumTotal);
        if (lastPrompt >= 0) node.put("promptTokens", lastPrompt);
        if (toolsTokens >= 0) node.put("toolsTokens", toolsTokens);
        if (contextWindow > 0) node.put("contextWindow", contextWindow);
        if (contextBreakdown != null) node.set("breakdown", contextBreakdown);
        return node.isEmpty() ? null : node;
    }

    com.fasterxml.jackson.databind.node.ArrayNode collectedReasoningSegments() {
        return publicText == null ? null : timeline.toJson(json);
    }

    com.fasterxml.jackson.databind.node.ArrayNode collectedToolCalls() {
        com.fasterxml.jackson.databind.node.ArrayNode array = json.createArrayNode();
        toolCalls.forEach(array::add);
        return array;
    }

    @Override
    public void onTextDelta(String text) {
        if (publicText == null) {
            plainText.append(text);
            sse.writeDelta(out, pendingMessageId, text, null);
        }
    }

    String collectedText() { return publicText==null?plainText.toString():publicText.text(); }

    @Override public void onTextDelta(int turn, int step, String attempt, String text) {
        publicText.delta(turn, step, attempt, text);
    }

    @Override
    public void onThinkingDelta(String text) {
        reasoningStreamed.append(text);
        if (publicText == null) {
            sse.writeReasoning(out, pendingMessageId, text);
            return;
        }
        thinkingStreamedThisStep = true;
        int offset = publicText.offset();
        sse.writeReasoning(out, pendingMessageId, text, offset, timeline.reasoning(offset, text));
    }

    void emitPhase(String phase, String name, String label) {
        if (phase.equals(lastPhase)) {
            return;
        }
        lastPhase = phase;
        sse.writeStatus(out, phase, name, label);
    }

    @Override
    public void onTurnStarted(int turn) {
        emitPhase("thinking", null, null);
    }

    @Override
    public void onStepStarted(int turn, int step) {
        if (publicText != null) publicText.start(turn, step);
        thinkingStreamedThisStep = false;
    }

    @Override
    public void onToolCall(String callId, String name, String arguments) {
        if (isTodoWrite(name)) {
            emitTodos(arguments);
        }

        lastPhase = "tool";
        ObjectNode status = ChatSseWriter.statusPayload(json, "tool", name, name, callId, arguments, false);
        // 同一份信息也记进落库用的列表：SSE 帧是「正在发生」，落库是「事后可查」。
        ObjectNode record = json.createObjectNode();
        if (publicText != null) {
            int offset = publicText.offset();
            int order = timeline.toolOrder();
            status.put("textOffset", offset);
            status.put("order", order);
            record.put("textOffset", offset);
            record.put("order", order);
        }
        sse.writeFrame(out, "status", status);
        if (callId != null && !callId.isBlank()) {
            record.put("callId", callId);
        }
        record.put("name", name == null ? "" : name);
        if (arguments != null && !arguments.isBlank()) {
            record.put("arguments", ChatSseWriter.truncate(arguments, ChatSseWriter.MAX_ARGUMENT_CHARS));
        }
        toolCalls.add(record);
    }

    private static boolean isTodoWrite(String name) {
        return "todo_write".equals(name) || "todowrite".equalsIgnoreCase(name == null ? "" : name.replace("_", ""));
    }

    private void emitTodos(String arguments) {
        if (arguments == null || arguments.isBlank()) {
            return;
        }
        JsonNode root;
        try {
            root = json.readTree(arguments);
        } catch (Exception ignored) {
            return;
        }
        JsonNode todos = root.path("todos");
        if (!todos.isArray()) {
            return;
        }
        ArrayNode items = json.createArrayNode();
        for (JsonNode todo : todos) {
            String content = todo.path("content").asText("");
            if (content.isBlank()) {
                continue;
            }
            ObjectNode item = json.createObjectNode();
            item.put("content", content);
            item.put("status", normalizeTodoStatus(todo.path("status").asText("")));
            items.add(item);
        }
        if (items.isEmpty()) {
            return;
        }
        latestTodos = items;
        ObjectNode data = json.createObjectNode();
        data.put("type", "todo");
        data.set("todos", items);
        sse.writeFrame(out, "todo", data);
    }

    private static String normalizeTodoStatus(String raw) {
        return switch (raw == null ? "" : raw) {
            case "in_progress", "in-progress", "inProgress", "running" -> "in_progress";
            case "completed", "done" -> "completed";
            default -> "pending";
        };
    }

    @Override
    public void onToolResult(String callId, String text, boolean isError) {
        sse.writeStatus(out, "tool", null, null, callId, null, isError);
        // 落库副本回填成败与结束标记：记录里要能区分「跑过但失败」和「还没跑完」。
        if (callId != null && !callId.isBlank()) {
            for (ObjectNode record : toolCalls) {
                if (callId.equals(record.path("callId").asText(null))) {
                    record.put("done", true);
                    if (isError) {
                        record.put("isError", true);
                    }
                    break;
                }
            }
        }
    }

    @Override
    public void onAssistantMessage(int turn, int step, String text, String reasoning) {
        if (reasoning != null && !reasoning.isBlank() && !thinkingStreamedThisStep) {
            publicText.start(turn, step);
            int offset = publicText.stepStart();
            int order = timeline.reasoning(offset, reasoning);
            if (reasoningStreamed.length() == 0) {
                sse.writeReasoning(out, pendingMessageId, reasoning, offset, order);
            }
        }
        publicText.commit(turn, step, text);
        onAssistantMessage(text, reasoning);
    }

    @Override
    public void onAssistantMessage(String text, String reasoning) {
        if (reasoning != null && !reasoning.isBlank() && reasoningStreamed.length() == 0) {
            sse.writeReasoning(out, pendingMessageId, reasoning);
        }
    }

    @Override
    public void onDiagnostic(String kind, String detail) {
        ObjectNode data = json.createObjectNode();
        data.put("type", "diagnostic");
        data.put("kind", kind);
        if (detail != null && !detail.isBlank()) {
            data.put("detail", detail);
        }
        sse.writeFrame(out, "diagnostic", data);
    }

    @Override
    public void onSessionTitle(String title) {
        if (title == null || title.isBlank()) {
            return;
        }
        titleChanged.accept(title);

        ObjectNode data = json.createObjectNode();
        data.put("type", "title");
        data.put("title", title);
        sse.writeFrame(out, "title", data);
    }

    @Override
    public void onUsage(DshSdkSession.Listener.TokenUsage usage) {
        ObjectNode data = json.createObjectNode();
        data.put("type", "usage");
        if (usage.inputTokens() >= 0) {
            data.put("inputTokens", usage.inputTokens());
        }
        if (usage.outputTokens() >= 0) {
            data.put("outputTokens", usage.outputTokens());
        }
        if (usage.cacheReadTokens() >= 0) {
            data.put("cacheReadTokens", usage.cacheReadTokens());
        }
        if (usage.cacheWriteTokens() >= 0) {
            data.put("cacheWriteTokens", usage.cacheWriteTokens());
        }
        if (usage.totalTokens() >= 0) {
            data.put("totalTokens", usage.totalTokens());
        }

        sumInput = addPositive(sumInput, usage.inputTokens());
        sumOutput = addPositive(sumOutput, usage.outputTokens());
        sumCacheRead = addPositive(sumCacheRead, usage.cacheReadTokens());
        sumTotal = addPositive(sumTotal, usage.totalTokens());

        if (usage.inputTokens() > 0) {
            long prompt = usage.inputTokens()
                    + Math.max(0, usage.cacheReadTokens())
                    + Math.max(0, usage.cacheWriteTokens());
            if (prompt > 0) {
                lastPrompt = prompt;
            }
        }
        sse.writeFrame(out, "usage", data);
    }

    private static long addPositive(long sum, long add) {
        if (add < 0) {
            return sum;
        }
        return sum < 0 ? add : sum + add;
    }

    @Override
    public void onContextWindow(long contextWindow) {
        if (contextWindow <= 0) {
            return;
        }
        this.contextWindow = contextWindow;
        ObjectNode data = json.createObjectNode();
        data.put("type", "context");
        data.put("contextWindow", contextWindow);
        sse.writeFrame(out, "context", data);
    }

    @Override
    public void onJob(DshSdkSession.Listener.JobInfo job) {
        if (job.jobId().isBlank()) {
            return;
        }
        ObjectNode data = json.createObjectNode();
        data.put("type", "job");
        data.put("jobId", job.jobId());
        data.put("kind", job.kind());
        data.put("label", job.label());
        data.put("status", job.status());
        if (job.durationMs() >= 0) {
            data.put("durationMs", job.durationMs());
        }
        if (job.detail() != null) {
            data.put("detail", job.detail());
        }
        sse.writeFrame(out, "job", data);
    }

    @Override
    public void onDeliverables(java.util.List<DshSdkSession.Listener.Deliverable> files) {
        if (files == null || files.isEmpty()) {
            return;
        }

        for (DshSdkSession.Listener.Deliverable f : files) {
            ObjectNode node = json.createObjectNode();
            node.put("path", f.path());
            if (f.description() != null) {
                node.put("description", f.description());
            }
            deliverables.put(f.path(), node);
        }
        ObjectNode data = json.createObjectNode();
        data.put("type", "deliverables");
        var array = json.createArrayNode();
        for (DshSdkSession.Listener.Deliverable f : files) {
            ObjectNode node = json.createObjectNode();
            node.put("path", f.path());
            if (f.description() != null) {
                node.put("description", f.description());
            }
            array.add(node);
        }
        data.set("files", array);
        sse.writeFrame(out, "deliverables", data);
    }

    @Override
    public void onToolsTokens(long toolsTokens) {
        if (toolsTokens <= 0) {
            return;
        }
        this.toolsTokens = toolsTokens;
        ObjectNode data = json.createObjectNode();
        data.put("type", "context");
        data.put("toolsTokens", toolsTokens);
        sse.writeFrame(out, "context", data);
    }

    @Override
    public void onContextBreakdown(DshSdkSession.Listener.ContextBreakdown breakdown) {
        if (breakdown == null) {
            return;
        }
        ObjectNode data = json.createObjectNode();
        data.put("type", "breakdown");
        data.put("systemTokens", breakdown.systemTokens());
        data.put("memoryTokens", breakdown.memoryTokens());
        data.put("filesTokens", breakdown.filesTokens());
        data.put("resultsTokens", breakdown.resultsTokens());
        data.put("chatTokens", breakdown.chatTokens());

        com.fasterxml.jackson.databind.node.ObjectNode stored = data.deepCopy();
        stored.remove("type");
        this.contextBreakdown = stored;
        sse.writeFrame(out, "context", data);
    }

    @Override
    public void onTurnEnded(boolean failed, String reason) {
        // 成败判定交给 Outcome；这里不发帧，避免在错误帧之前先发一个误导性的状态。
    }

    @Override
    public void onIdle() {
        // 结束帧由 stream() 在落库之后统一发出，保证顺序是 completed → end。
    }
}
