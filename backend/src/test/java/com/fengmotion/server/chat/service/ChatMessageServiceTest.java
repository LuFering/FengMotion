package com.fengmotion.server.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.chat.api.dto.CreateChatMessageRequest;
import com.fengmotion.server.chat.domain.ChatMessage;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatMessageIdempotencyRepository;
import com.fengmotion.server.chat.store.ChatMessageRepository;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.common.ApiException;

/**
 * 验证发送消息的业务规则：空内容、target 数量、幂等重试和错误码。
 *
 * <p>使用模拟仓储，不访问数据库；消息序号分配属于存储层，在仓储测试里覆盖。</p>
 */
class ChatMessageServiceTest {
    private static final String SESSION_ID = "session-1";
    private static final Instant NOW = Instant.parse("2026-01-01T10:00:00Z");

    private final ChatSessionRepository sessions = mock(ChatSessionRepository.class);
    private final ChatMessageRepository messages = mock(ChatMessageRepository.class);
    private final ChatMessageIdempotencyRepository idempotency = mock(ChatMessageIdempotencyRepository.class);
    private final ObjectMapper json = new ObjectMapper();
    private final ChatMessageService service = new ChatMessageService(sessions, messages, idempotency, json);

    /** 正常文本消息被追加，并刷新会话更新时间。 */
    @Test
    void appendsUserMessageAndTouchesSession() {
        activeSession();
        when(messages.append(any())).thenAnswer(call -> {
            ChatMessage m = call.getArgument(0);
            return new ChatMessage(m.id(), m.sessionId(), 1, m.role(), m.text(), m.taskId(),
                    m.references(), m.attachments(), m.toolCalls(), m.createdAt());
        });

        ChatMessageService.Sent sent = service.send(SESSION_ID, request("你好", null, null), null);

        assertEquals("你好", sent.message().text());
        assertEquals(1, sent.message().seq());
        assertEquals(ChatMessage.ROLE_USER, sent.message().role());
        assertNull(sent.taskId());
        verify(messages).acquireWriteLock();
        verify(sessions).touch(eq(SESSION_ID), any(Instant.class));
    }

    /** 空白文本且没有附件 → 400，不写库。 */
    @Test
    void rejectsEmptyTextWithoutAttachments() throws Exception {
        activeSession();

        ApiException error = assertThrows(ApiException.class,
                () -> service.send(SESSION_ID, request("   ", null, null), null));

        assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
        assertEquals("validation_error", error.getCode());
        verify(messages, never()).append(any());
    }

    /** 只有附件、文本为空是合法的（契约允许只发附件）。 */
    @Test
    void acceptsAttachmentsWithEmptyText() throws Exception {
        activeSession();
        when(messages.append(any())).thenAnswer(call -> call.getArgument(0));

        ChatMessageService.Sent sent = service.send(SESSION_ID,
                request("", null, json.readTree("[{\"name\":\"a.png\",\"mimeType\":\"image/png\",\"sizeBytes\":1}]")),
                null);

        assertEquals("", sent.message().text());
    }

    /** 两个 target 引用 → 400：一条消息只能指定一个修改目标。 */
    @Test
    void rejectsMultipleTargetReferences() throws Exception {
        activeSession();
        JsonNode references = json.readTree("""
                [{"id":"a","role":"target","kind":"scene","sceneId":"s1","label":"A"},
                 {"id":"b","role":"target","kind":"scene","sceneId":"s2","label":"B"}]
                """);

        ApiException error = assertThrows(ApiException.class,
                () -> service.send(SESSION_ID, request("改这两处", references, null), null));

        assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
        verify(messages, never()).append(any());
    }

    /** target 与 context 各一个则合法；context 不受数量限制。 */
    @Test
    void acceptsOneTargetAndContextReferences() throws Exception {
        activeSession();
        when(messages.append(any())).thenAnswer(call -> call.getArgument(0));
        JsonNode references = json.readTree("""
                [{"id":"a","role":"target","kind":"scene","sceneId":"s1","label":"A"},
                 {"id":"b","role":"context","kind":"project","projectId":"p1","label":"P"}]
                """);

        service.send(SESSION_ID, request("改这里", references, null), null);

        verify(messages).append(any());
    }

    /** 引用不是数组时返回 400，而不是静默忽略。 */
    @Test
    void rejectsNonArrayReferences() throws Exception {
        activeSession();

        ApiException error = assertThrows(ApiException.class,
                () -> service.send(SESSION_ID, request("文本", json.readTree("{}"), null), null));

        assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
        verify(messages, never()).append(any());
    }

    /** 会话不存在 → 404，且不取写锁。 */
    @Test
    void rejectsUnknownSession() {
        when(sessions.findById("missing")).thenReturn(Optional.empty());

        ApiException error = assertThrows(ApiException.class,
                () -> service.send("missing", request("你好", null, null), null));

        assertEquals(HttpStatus.NOT_FOUND, error.getStatus());
        verify(messages, never()).append(any());
    }

    /** 同一幂等键 + 同内容：返回首次消息，不追加第二条。 */
    @Test
    void returnsOriginalMessageForIdempotentRetry() {
        activeSession();
        when(messages.append(any())).thenAnswer(call -> {
            ChatMessage m = call.getArgument(0);
            return new ChatMessage(m.id(), m.sessionId(), 1, m.role(), m.text(), m.taskId(),
                    m.references(), m.attachments(), m.toolCalls(), m.createdAt());
        });
        ChatMessageService.Sent first = service.send(SESSION_ID, request("你好", null, null), "key-1");

        // 捕获首次写入时保存的摘要，用它模拟重试命中的同一条记录。
        ArgumentCaptor<String> hash = ArgumentCaptor.forClass(String.class);
        verify(idempotency).save(eq("key-1"), hash.capture(), eq(SESSION_ID),
                eq(first.message().id()), any(Instant.class));
        when(idempotency.findByKey("key-1")).thenReturn(Optional.of(
                new ChatMessageIdempotencyRepository.Record(hash.getValue(), SESSION_ID,
                        first.message().id(), Instant.now())));
        when(messages.findById(first.message().id())).thenReturn(Optional.of(first.message()));

        ChatMessageService.Sent retried = service.send(SESSION_ID, request("你好", null, null), "key-1");

        assertEquals(first.message().id(), retried.message().id());
        verify(messages).append(any()); // 只追加过一次
    }

    /** 同一幂等键 + 不同内容：409 idempotency_conflict。 */
    @Test
    void rejectsIdempotencyKeyReusedWithDifferentBody() {
        activeSession();
        when(messages.append(any())).thenAnswer(call -> call.getArgument(0));
        service.send(SESSION_ID, request("你好", null, null), "key-1");
        // 记录必须仍在 24 小时有效期内，否则会被当成过期键而不是内容冲突。
        when(idempotency.findByKey("key-1")).thenReturn(Optional.of(
                new ChatMessageIdempotencyRepository.Record("stored-hash", SESSION_ID, "m1", Instant.now())));

        ApiException error = assertThrows(ApiException.class,
                () -> service.send(SESSION_ID, request("改主意了", null, null), "key-1"));

        assertEquals(HttpStatus.CONFLICT, error.getStatus());
        assertEquals("idempotency_conflict", error.getCode());
    }

    /** 过期幂等记录允许复用键：先删除旧记录，再写入新消息。 */
    @Test
    void reusesExpiredIdempotencyKey() {
        activeSession();
        when(messages.append(any())).thenAnswer(call -> call.getArgument(0));
        when(idempotency.findByKey("key-1")).thenReturn(Optional.of(
                new ChatMessageIdempotencyRepository.Record("old-hash", SESSION_ID, "m-old",
                        Instant.parse("2025-01-01T00:00:00Z"))));

        service.send(SESSION_ID, request("新内容", null, null), "key-1");

        verify(idempotency).delete("key-1");
        verify(idempotency).save(eq("key-1"), anyString(), eq(SESSION_ID), anyString(), any(Instant.class));
        verify(messages).append(any());
    }

    /** 空幂等键无效。 */
    @Test
    void rejectsBlankIdempotencyKey() {
        activeSession();

        ApiException error = assertThrows(ApiException.class,
                () -> service.send(SESSION_ID, request("你好", null, null), "  "));

        assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
        verify(messages, never()).acquireWriteLock();
        verify(messages, never()).append(any());
    }

    /** 列表按序号翻页，多取一条时返回下一页游标。 */
    @Test
    void listsMessagesWithCursor() {
        activeSession();
        when(messages.findAfterSeq(SESSION_ID, 0, 3))
                .thenReturn(List.of(message("m1", 1, "一"), message("m2", 2, "二"), message("m3", 3, "三")));

        ChatMessageService.Page page = service.list(SESSION_ID, null, 2);

        assertEquals(List.of("一", "二"), page.items().stream().map(ChatMessage::text).toList());
        // 游标位置是本页最后一条的序号，不是条数。
        assertEquals("Mg", page.nextCursor());
    }

    /** 没有更多消息时游标为 null。 */
    @Test
    void returnsNullCursorWhenNoMoreMessages() {
        activeSession();
        when(messages.findAfterSeq(SESSION_ID, 0, 51)).thenReturn(List.of(message("m1", 1, "一")));

        assertNull(service.list(SESSION_ID, null, 50).nextCursor());
    }

    /** 会话不存在时列表返回 404。 */
    @Test
    void rejectsListingUnknownSession() {
        when(sessions.findById("missing")).thenReturn(Optional.empty());

        ApiException error = assertThrows(ApiException.class,
                () -> service.list("missing", null, 50));

        assertEquals(HttpStatus.NOT_FOUND, error.getStatus());
        verify(messages, never()).findAfterSeq(anyString(), anyLong(), anyInt());
    }

    /** limit 越界 → 400。 */
    @Test
    void rejectsInvalidLimit() {
        activeSession();

        for (int limit : new int[] {0, 201}) {
            ApiException error = assertThrows(ApiException.class,
                    () -> service.list(SESSION_ID, null, limit));
            assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
        }
        verify(messages, never()).findAfterSeq(anyString(), anyLong(), anyInt());
    }

    /** 不是本服务发出的游标 → 400。 */
    @Test
    void rejectsMalformedCursor() {
        activeSession();

        ApiException error = assertThrows(ApiException.class,
                () -> service.list(SESSION_ID, "not-a-cursor!", 50));

        assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
    }

    private void activeSession() {
        when(sessions.findById(SESSION_ID)).thenReturn(Optional.of(
                new ChatSession(SESSION_ID, "project-1", "对话", NOW, NOW)));
    }

    private static CreateChatMessageRequest request(String text, JsonNode references, JsonNode attachments) {
        return new CreateChatMessageRequest(text, references, attachments, null);
    }

    private static ChatMessage message(String id, long seq, String text) {
        return new ChatMessage(id, SESSION_ID, seq, ChatMessage.ROLE_USER, text, null, null, null, null, NOW);
    }

}
