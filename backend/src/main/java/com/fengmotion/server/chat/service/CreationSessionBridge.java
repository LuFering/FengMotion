package com.fengmotion.server.chat.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fengmotion.server.chat.api.dto.CreateChatMessageRequest;
import com.fengmotion.server.chat.domain.ChatMessage;
import com.fengmotion.server.chat.store.ChatMessageRepository;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.creation.domain.CreationSessionAccess;

import lombok.RequiredArgsConstructor;

@Component
@RequiredArgsConstructor
public class CreationSessionBridge implements CreationSessionAccess {
    private final ChatSessionRepository sessions;
    private final ChatMessageRepository messages;
    private final ChatMessageService chatMessages;

    @Override
    public void validate(String projectId, String sessionId, String userMessageId) {
        if (sessionId == null && userMessageId == null) return;
        if (sessionId == null || userMessageId == null) throw bad("会话和用户消息必须同时提供");
        var session = sessions.findById(sessionId).orElseThrow(() -> bad("会话不存在"));
        var message = messages.findById(userMessageId).orElseThrow(() -> bad("用户消息不存在"));
        if (!projectId.equals(session.projectId()) || !session.id().equals(message.sessionId())
                || !ChatMessage.ROLE_USER.equals(message.role())) {
            throw bad("项目、会话与用户消息不匹配");
        }
    }

    @Override
    public void saveReply(String sessionId, String userMessageId, String requestId, String reply) {
        String key = "idem-reply-" + (userMessageId != null && !userMessageId.isBlank() ? userMessageId : requestId);
        chatMessages.send(sessionId,
                new CreateChatMessageRequest(reply, null, null, ChatMessage.ROLE_ASSISTANT, userMessageId), key);
    }

    private static ApiException bad(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "validation_error", message);
    }
}
