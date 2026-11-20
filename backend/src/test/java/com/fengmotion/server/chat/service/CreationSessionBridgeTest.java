package com.fengmotion.server.chat.service;

import java.time.Instant;
import java.util.Optional;

import org.junit.jupiter.api.Test;

import com.fengmotion.server.chat.api.dto.CreateChatMessageRequest;
import com.fengmotion.server.chat.domain.ChatMessage;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatMessageRepository;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.common.ApiException;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CreationSessionBridgeTest {
    private final ChatSessionRepository sessions = mock(ChatSessionRepository.class);
    private final ChatMessageRepository messages = mock(ChatMessageRepository.class);
    private final ChatMessageService replies = mock(ChatMessageService.class);
    private final CreationSessionBridge bridge = new CreationSessionBridge(sessions, messages, replies);

    @Test void acceptsUnscopedRequestsWithoutLookingUpAConversation() {
        bridge.validate("project", null, null);
        verifyNoInteractions(sessions, messages, replies);
    }

    @Test void rejectsIncompleteConversationIdentityBeforeLookingUpMessages() {
        assertThrows(ApiException.class, () -> bridge.validate("project", "session", null));
        assertThrows(ApiException.class, () -> bridge.validate("project", null, "message"));
        verifyNoInteractions(sessions, messages, replies);
    }

    @Test void acceptsOnlyAUserMessageFromTheSpecifiedProjectAndSession() {
        seed("project", "session", ChatMessage.ROLE_USER);
        assertDoesNotThrow(() -> bridge.validate("project", "session", "message"));
        assertThrows(ApiException.class, () -> bridge.validate("other-project", "session", "message"));
        seed("project", "another-session", ChatMessage.ROLE_USER);
        assertThrows(ApiException.class, () -> bridge.validate("project", "session", "message"));
        seed("project", "session", ChatMessage.ROLE_ASSISTANT);
        assertThrows(ApiException.class, () -> bridge.validate("project", "session", "message"));
    }

    @Test void missingSessionOrMessageProducesTheExistingValidationError() {
        when(sessions.findById("session")).thenReturn(Optional.empty());
        ApiException missingSession = assertThrows(ApiException.class, () -> bridge.validate("project", "session", "message"));
        assertEquals("validation_error", missingSession.getCode());
        seed("project", "session", ChatMessage.ROLE_USER);
        when(messages.findById("message")).thenReturn(Optional.empty());
        assertEquals("validation_error", assertThrows(ApiException.class, () -> bridge.validate("project", "session", "message")).getCode());
    }

    @Test void savingReplyPreservesItsRoleTriggerAndIdempotencyKey() {
        bridge.saveReply("session", "message", "request", "已渲染。");
        verify(replies).send(eq("session"),
                eq(new CreateChatMessageRequest("已渲染。", null, null, ChatMessage.ROLE_ASSISTANT, "message")),
                eq("idem-reply-message"));
        bridge.saveReply("session", null, "request", "补充说明");
        verify(replies).send(eq("session"), any(CreateChatMessageRequest.class), eq("idem-reply-request"));
    }

    private void seed(String project, String messageSession, String role) {
        Instant now = Instant.parse("2026-11-19T00:00:00Z");
        when(sessions.findById("session")).thenReturn(Optional.of(new ChatSession("session", project, "会话", now, now)));
        when(messages.findById("message")).thenReturn(Optional.of(new ChatMessage(
                "message", messageSession, 1, role, "需求", null, null, null, null, now)));
    }
}
