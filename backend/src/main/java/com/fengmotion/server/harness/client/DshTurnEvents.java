package com.fengmotion.server.harness.client;

import java.util.ArrayList;
import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.harness.client.DshSdkSession.Listener;
import com.fengmotion.server.harness.client.DshSdkSession.Outcome;

final class DshTurnEvents {
    private final String sessionId;
    private final String cwd;
    private final ContextBreakdownMeter breakdownMeter;
    private final StringBuilder text = new StringBuilder();
    private final ReasoningTrace reasoning = new ReasoningTrace();
    private boolean failed;
    private String failure;
    private int turn;
    private int step;

    DshTurnEvents(String sessionId, String cwd, ContextBreakdownMeter breakdownMeter) {
        this.sessionId = sessionId;
        this.cwd = cwd;
        this.breakdownMeter = breakdownMeter;
    }

    boolean notification(JsonNode frame, Listener active, Listener listener) {
        String method = frame.path("method").asText("");
        JsonNode params = frame.path("params");
        if (!sessionId.equals(params.path("sessionId").asText(""))) return false;
        if ("session.status".equals(method)) {
            String status = params.path("status").asText("");
            if ("running".equals(status)) active.onTurnStarted(turn == 0 ? 1 : turn);
            return "idle".equals(status);
        }
        if (!"session.event".equals(method)) return false;
        JsonNode event = params.path("event");
        String type = event.path("type").asText("");
        JsonNode data = event.path("data");
        breakdownMeter.accept(type, event.path("seq").asLong(-1), event.path("surfaceOp"), data);
        switch (type) {
            case "turn/start" -> {
                turn = data.path("turn").asInt(1);
                step = 0;
                active.onTurnStarted(turn);
            }
            case "step/start" -> {
                step = data.path("step").asInt(step + 1);
                active.onStepStarted(data.path("turn").asInt(turn), step);
            }
            case "tool/call" -> active.onToolCall(
                    data.path("callId").asText(""),
                    data.path("name").asText(""),
                    data.path("arguments").asText(""));
            case "tool/result" -> {
                JsonNode message = data.path("message");
                active.onToolResult(
                        message.path("toolCallId").asText(""),
                        collectText(message.path("content")),
                        message.path("isError").asBoolean(false));
            }
            case "session/title" -> {
                // DSH 自己会命名会话；不透传的话左栏只能显示「未命名对话」。
                listener.onSessionTitle(data.path("title").asText(""));
            }
            case "assistant/message" -> {
                JsonNode message = data.path("message");
                String body = collectText(message.path("content"));
                String think = collectReasoning(message.path("content"));
                text.setLength(0);
                text.append(body);

                reasoning.appendMessageReasoning(think);
                active.onAssistantMessage(data.path("turn").asInt(turn), data.path("step").asInt(step), body, think);
                // 用量挂在消息上而不是独立事件（实测）：在同一个分支里顺带取出。
                // 缺字段用 -1 表示「上游没给」，不用 0 —— 0 是「用了 0 个 token」，
                // 与「不知道用了多少」是两件事，界面上不该混为一谈。
                JsonNode usage = data.path("usage");
                listener.onUsage(new Listener.TokenUsage(
                        usage.path("inputTokens").asLong(-1),
                        usage.path("outputTokens").asLong(-1),
                        usage.path("cacheReadTokens").asLong(-1),
                        usage.path("cacheWriteTokens").asLong(-1),
                        usage.path("totalTokens").asLong(-1)));
            }
            case "turn/end" -> {
                JsonNode reason = data.path("reason");
                String kind = reason.path("kind").asText("completed");
                failed = !"completed".equals(kind);
                failure = failed ? describeFailure(reason) : null;

                active.onContextBreakdown(breakdownMeter.snapshot(cwd));
                active.onTurnEnded(failed, failure);
            }

            case "compaction/start", "manual-compaction" ->
                    listener.onDiagnostic("compaction", "上下文已满，正在压缩历史记录");
            case "compaction/summary" ->
                    listener.onDiagnostic("compaction", "上下文已压缩，早期对话被摘要替代");
            case "compaction/end" ->
                    listener.onDiagnostic("compaction", "上下文压缩完成");
            case "turn-max-tokens" -> {

                listener.onDiagnostic("max-tokens", "本回合达到 token 上限，回复可能不完整");
                failed = true;
                if (failure == null) {
                    failure = "本回合达到 token 上限，回复被截断";
                }
            }
            case "llm/retry", "llm/retry-started" -> {
                String why = data.path("error").path("message").asText("");
                listener.onDiagnostic("retry",
                        why.isBlank() ? "模型调用失败，正在重试" : "模型调用失败，正在重试：" + why);
            }

            case "job/registered" -> listener.onJob(new Listener.JobInfo(
                    data.path("jobId").asText(""),
                    data.path("kind").asText(""),
                    data.path("label").asText(""),
                    "running",
                    -1L,
                    null));
            case "job/settled" -> {
                long started = data.path("startedAt").asLong(0);
                long finished = data.path("finishedAt").asLong(0);
                long duration = (started > 0 && finished >= started) ? finished - started : -1L;
                String detail = data.path("detail").asText("");
                listener.onJob(new Listener.JobInfo(
                        data.path("jobId").asText(""),
                        data.path("kind").asText(""),
                        data.path("label").asText(""),
                        data.path("status").asText("completed"),
                        duration,
                        detail.isBlank() ? null : detail));
            }

            case "deliverables/presented" -> {
                JsonNode files = data.path("files");
                if (files.isArray() && !files.isEmpty()) {
                    java.util.List<Listener.Deliverable> list = new java.util.ArrayList<>();
                    for (JsonNode f : files) {
                        String path = f.path("path").asText("");
                        if (path.isBlank()) {
                            continue;
                        }
                        String desc = f.path("description").asText("");
                        list.add(new Listener.Deliverable(path, desc.isBlank() ? null : desc));
                    }
                    if (!list.isEmpty()) {
                        listener.onDeliverables(list);
                    }
                }
            }
            case "request/context" -> {
                JsonNode window = data.path("contextWindow");
                if (window.isNumber()) {
                    active.onContextWindow(window.asLong());
                }
            }

            case "request/header" -> {
                JsonNode tools = data.path("header").path("tools");
                if (tools.isArray() && !tools.isEmpty()) {
                    long chars = tools.toString().length();

                    long tokens = (chars + 3) / 4 + 4;
                    breakdownMeter.setToolsTokens(tokens);
                    active.onToolsTokens(tokens);
                }
            }
            default -> {
                // 其他事件（permission/preset 等）
                // 不影响本轮结果，按协议忽略即可。
            }
        }
        return false;
    }

    Outcome outcome() { return new Outcome(text.toString(), reasoning.result(), failed, failure); }

    void stream(JsonNode frame, Listener listener) {
        if (!"stream/delta".equals(frame.path("method").asText(""))) {
            return;
        }
        JsonNode params = frame.path("params");
        if (params.hasNonNull("sessionId") && !sessionId.equals(params.path("sessionId").asText())) return;
        String kind = params.path("kind").asText("");
        if ("text".equals(kind)) {
            String text = params.path("text").asText("");
            if (!text.isEmpty()) {
                if (params.path("turn").isIntegralNumber() && params.path("step").isIntegralNumber() && params.path("attemptId").isTextual()) {
                    listener.onTextDelta(params.get("turn").intValue(), params.get("step").intValue(), params.get("attemptId").textValue(), text);
                } else listener.onTextDelta(text);
            }
        } else if ("thinking".equals(kind)) {
            String text = params.path("text").asText("");
            if (!text.isEmpty()) {
                reasoning.appendDelta(text);
                listener.onThinkingDelta(text);
            }
        } else if ("block_end".equals(kind)) {

            if ("reasoning".equals(params.path("blockType").asText(""))) {
                String text = params.path("text").asText("");
                if (reasoning.appendBlockOnce(text)) {
                    listener.onThinkingDelta(text);
                }
            }
        }
    }

    private static String collectText(JsonNode content) {
        if (content == null || !content.isArray()) {
            return "";
        }
        List<String> parts = new ArrayList<>();
        for (JsonNode block : content) {
            if ("text".equals(block.path("type").asText("")) && block.path("text").isTextual()) {
                parts.add(block.path("text").asText());
            }
        }
        return String.join("\n", parts);
    }

    private static String collectReasoning(JsonNode content) {
        if (content == null || !content.isArray()) {
            return "";
        }
        List<String> parts = new ArrayList<>();
        for (JsonNode block : content) {
            if ("reasoning".equals(block.path("type").asText("")) && block.path("text").isTextual()) {
                parts.add(block.path("text").asText());
            }
        }
        return String.join("\n", parts);
    }

    private static String describeFailure(JsonNode reason) {
        JsonNode error = reason.path("error");
        String message = error.path("message").asText("");
        String code = error.path("code").asText("");
        if (!message.isEmpty() && !code.isEmpty()) {
            return code + ": " + message;
        }
        if (!message.isEmpty()) {
            return message;
        }
        return reason.path("kind").asText("error");
    }

    private static final class ReasoningTrace {
        private final StringBuilder text = new StringBuilder();

        private boolean messageSeen;

        void appendDelta(String chunk) {
            text.append(chunk);
        }

        boolean appendBlockOnce(String whole) {
            if (whole == null || whole.isEmpty()) {
                return false;
            }
            if (text.length() >= whole.length()
                    && text.substring(text.length() - whole.length()).contentEquals(whole)) {
                return false;
            }
            text.append(whole);
            return true;
        }

        void appendMessageReasoning(String whole) {
            if (whole == null || whole.isBlank() || messageSeen || text.length() > 0) {
                return;
            }
            messageSeen = true;
            text.append(whole);
        }

        String result() {
            return text.toString();
        }
    }

}
