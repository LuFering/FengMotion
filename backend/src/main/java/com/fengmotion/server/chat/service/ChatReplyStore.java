package com.fengmotion.server.chat.service;

import java.time.Instant;
import java.util.UUID;

import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.chat.domain.ChatMessage;
import com.fengmotion.server.chat.store.ChatMessageRepository;
import com.fengmotion.server.chat.store.ChatSessionRepository;

final class ChatReplyStore {
    private final ChatMessageRepository messages;
    private final ChatSessionRepository sessions;
    private final TransactionTemplate transactions;

    ChatReplyStore(ChatMessageRepository messages, ChatSessionRepository sessions, TransactionTemplate transactions) {
        this.messages = messages;
        this.sessions = sessions;
        this.transactions = transactions;
    }

    ChatMessage append(String sessionId, String text, String reasoning,
                       JsonNode toolCalls, JsonNode todos, JsonNode usage,
                       JsonNode deliverables, JsonNode reasoningSegments) {
        String body = text == null || text.isBlank() ? "" : text;
        return transactions.execute(status -> {
            messages.acquireWriteLock();
            Instant now = Instant.now();
            ChatMessage saved = messages.append(new ChatMessage(
                    UUID.randomUUID().toString(),
                    sessionId,
                    0,
                    ChatMessage.ROLE_ASSISTANT,
                    body,
                    null,
                    null,
                    null,
                    // 空数组存 null：没有工具调用时不留一个 []，读回来仍是「没有」。
                    toolCalls == null || toolCalls.isEmpty() ? null : toolCalls,
                    // 空白推理同样存 null：界面上「没有思考过程」只有一种表示。
                    reasoning == null || reasoning.isBlank() ? null : reasoning,
                    // 空清单同样存 null：没有任务清单时读回来仍是「没有」。
                    todos == null || todos.isEmpty() ? null : todos,
                    usage == null || usage.isEmpty() ? null : usage,
                    // 空数组同样存 null：没有交付时读回来仍是「没有」。
                    deliverables == null || deliverables.isEmpty() ? null : deliverables,
                    reasoningSegments == null || reasoningSegments.isEmpty() ? null : reasoningSegments,
                    now));
            sessions.touch(sessionId, now);
            return saved;
        });
    }
}
