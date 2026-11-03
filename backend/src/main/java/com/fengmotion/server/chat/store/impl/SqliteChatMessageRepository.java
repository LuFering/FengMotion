package com.fengmotion.server.chat.store.impl;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.chat.domain.ChatMessage;
import com.fengmotion.server.chat.store.ChatMessageRepository;
import com.fengmotion.server.chat.store.mapper.ChatMessageMapper;
import com.fengmotion.server.chat.store.mapper.ChatMessageRow;

import lombok.RequiredArgsConstructor;

/**
 * 使用 MyBatis 在 SQLite 中追加和读取会话消息。
 *
 * <p>结构化引用和附件以 JSON 文本整列保存：服务端不解释其字段（形状由契约定义），
 * 因此不需要为多态引用建表；写回时原样反序列化为 JSON 树。</p>
 *
 * <p>序号分配：先读 {@code MAX(seq)} 再写入 {@code MAX + 1}。这一步必须位于调用方的
 * 事务内，才能和会话更新时间刷新一起提交；并发写入同一会话时，
 * {@code UNIQUE(session_id, seq)} 会让后写者失败，而不是产生重复序号。</p>
 */
@Repository
@RequiredArgsConstructor
public class SqliteChatMessageRepository implements ChatMessageRepository {
    private final ChatMessageMapper mapper;
    private final ObjectMapper json;

    @Override
    public void acquireWriteLock() {
        // 空更新不修改会话行；在调用方事务内提前请求 SQLite 写锁。
        mapper.acquireWriteLock();
    }

    @Override
    public ChatMessage append(ChatMessage message) {
        Long max = mapper.findMaxSeq(message.sessionId());
        long seq = (max == null ? 0 : max) + 1;

        ChatMessageRow row = new ChatMessageRow();
        row.setId(message.id());
        row.setSessionId(message.sessionId());
        row.setSeq(seq);
        row.setRole(message.role());
        row.setText(message.text());
        row.setTaskId(message.taskId());
        row.setReferencesJson(toJson(message.references()));
        row.setAttachmentsJson(toJson(message.attachments()));
        row.setToolCallsJson(toJson(message.toolCalls()));
        row.setCreatedAt(message.createdAt().toString());
        mapper.insert(row);

        // 返回带真实序号的对象，调用方可直接用于响应与游标。
        return new ChatMessage(message.id(), message.sessionId(), seq, message.role(), message.text(),
                message.taskId(), message.references(), message.attachments(), message.toolCalls(),
                message.createdAt());
    }

    @Override
    public Optional<ChatMessage> findById(String id) {
        return Optional.ofNullable(mapper.findById(id)).map(this::toDomain);
    }

    @Override
    public int countBySessionId(String sessionId) {
        return mapper.countBySessionId(sessionId);
    }

    @Override
    public List<ChatMessage> findAfterSeq(String sessionId, long afterSeq, int limit) {
        return mapper.findAfterSeq(sessionId, afterSeq, limit).stream().map(this::toDomain).toList();
    }

    /** JSON 树序列化为文本；空树视同没有内容，存 NULL 而不是 "null"。 */
    private String toJson(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        try {
            return json.writeValueAsString(node);
        } catch (JsonProcessingException ex) {
            // 输入来自已解析的 JSON 树，正常不会失败；失败说明对象图异常，不应静默丢字段。
            throw new IllegalStateException("无法序列化消息附加字段", ex);
        }
    }

    /** 文本还原为 JSON 树；列值为 NULL 时返回 null。 */
    private JsonNode fromJson(String text) {
        if (text == null) {
            return null;
        }
        try {
            return json.readTree(text);
        } catch (JsonProcessingException ex) {
            // 库里的 JSON 由本类写入；读不出来说明数据被外部改坏，按内部错误暴露。
            throw new IllegalStateException("无法解析消息附加字段", ex);
        }
    }

    private ChatMessage toDomain(ChatMessageRow row) {
        return new ChatMessage(
                row.getId(),
                row.getSessionId(),
                row.getSeq(),
                row.getRole(),
                row.getText(),
                row.getTaskId(),
                fromJson(row.getReferencesJson()),
                fromJson(row.getAttachmentsJson()),
                fromJson(row.getToolCallsJson()),
                Instant.parse(row.getCreatedAt()));
    }
}
