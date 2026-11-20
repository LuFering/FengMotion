package com.fengmotion.server.chat.service;

import java.io.PrintWriter;
import java.util.UUID;
import java.util.function.Supplier;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.chat.domain.ChatMessage;

final class ChatSseWriter {
    static final int MAX_ARGUMENT_CHARS = 4000;
    private final ObjectMapper json;
    private final Supplier<Runnable> flush;

    ChatSseWriter(ObjectMapper json, Supplier<Runnable> flush) {
        this.json = json;
        this.flush = flush;
    }

    void writeStatus(PrintWriter out, String phase, String toolName, String label) {
        writeStatus(out, phase, toolName, label, null, null, false);
    }

    static ObjectNode statusPayload(ObjectMapper json, String phase, String toolName, String label,
                                    String callId, String arguments, boolean isError) {
        ObjectNode data = json.createObjectNode();
        data.put("type", "status");
        data.put("phase", phase);
        if (toolName != null) {
            data.put("name", toolName);
        }
        if (label != null) {
            data.put("label", label);
        }
        if (callId != null && !callId.isBlank()) {
            data.put("callId", callId);
        }
        if (arguments != null && !arguments.isBlank()) {
            data.put("arguments", truncate(arguments, MAX_ARGUMENT_CHARS));
        }
        if (isError) {
            data.put("isError", true);
        }
        return data;
    }

    void writeStatus(PrintWriter out, String phase, String toolName, String label,
                     String callId, String arguments, boolean isError) {
        writeFrame(out, "status",
                statusPayload(json, phase, toolName, label, callId, arguments, isError));
    }

    static String truncate(String text, int maxLength) {
        if (text.length() <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + "…";
    }

    void writeDelta(PrintWriter out, String messageId, String delta, Integer replaceFrom) {
        ObjectNode data = json.createObjectNode();
        data.put("type", "delta");
        data.put("messageId", messageId);
        data.put("delta", delta);
        if (replaceFrom != null) data.put("replaceFrom", replaceFrom);
        writeFrame(out, "delta", data);
    }

    void writeReasoning(PrintWriter out, String messageId, String delta) {
        writeReasoning(out, messageId, delta, null, null);
    }

    void writeReasoning(PrintWriter out, String messageId, String delta, Integer textOffset, Integer order) {
        ObjectNode data = json.createObjectNode();
        data.put("type", "reasoning");
        data.put("messageId", messageId);
        data.put("delta", delta);
        if (textOffset != null) data.put("textOffset", textOffset);
        if (order != null) data.put("order", order);
        writeFrame(out, "reasoning", data);
    }

    void writeCompleted(PrintWriter out, ChatMessage message) {
        ObjectNode data = json.createObjectNode();
        data.put("type", "completed");
        ObjectNode body = data.putObject("message");
        body.put("id", message.id());
        body.put("sessionId", message.sessionId());
        body.put("role", message.role());
        body.put("text", message.text());
        if (message.toolCalls() != null) body.set("toolCalls", message.toolCalls());
        // 思考过程随 completed 一起下发：前端据此把它挂到这条回复上，
        // 之后切走再回来由历史接口读回，两处都走同一个字段名。
        if (message.reasoning() != null) {
            body.put("reasoning", message.reasoning());
        }
        if (message.reasoningSegments() != null) {
            body.set("reasoningSegments", message.reasoningSegments());
        }
        // 任务清单随 completed 一起下发：前端先挂到这条回复上，
        // 之后由历史接口读回（同一个字段名），保证两个时刻看到的一致。
        if (message.todos() != null) {
            body.set("todos", message.todos());
        }
        if (message.usage() != null) {
            body.set("usage", message.usage());
        }
        if (message.deliverables() != null) {
            body.set("deliverables", message.deliverables());
        }
        body.put("createdAt", message.createdAt().toString());
        writeFrame(out, "completed", data);
    }

    void writeError(PrintWriter out, String code, String message) {
        ObjectNode data = json.createObjectNode();
        ObjectNode error = data.putObject("error");
        error.put("code", code);
        error.put("message", message);
        error.put("requestId", "req_" + UUID.randomUUID());
        writeFrame(out, "error", data);
    }

    void writeStopped(PrintWriter out) {
        ObjectNode data = json.createObjectNode();
        data.put("reason", "user_stopped");
        writeFrame(out, "stopped", data);
    }

    void writeEnd(PrintWriter out) {
        ObjectNode data = json.createObjectNode();
        data.put("type", "end");
        writeFrame(out, "end", data);
    }

    void writeFrame(PrintWriter out, String event, ObjectNode data) {
        if (out == null) return;
        out.write("event: " + event + "\n");
        out.write("data: " + data.toString() + "\n\n");
        out.flush();
        // Tomcat 的 Writer.flush() 不保证立刻把字节推给客户端：响应还有一层缓冲。
        // 显式 flushBuffer 才能让每个 delta 帧立即到达，否则前端看到的是批量到达。
        Runnable flushAction = flush.get();
        if (flushAction != null) {
            try {
                flushAction.run();
            } catch (RuntimeException ignored) {
                // 客户端已断开时 flush 会抛异常；连接已无用，忽略即可。
            }
        }
    }
}
