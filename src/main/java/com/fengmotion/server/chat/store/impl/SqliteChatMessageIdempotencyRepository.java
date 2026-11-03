package com.fengmotion.server.chat.store.impl;

import java.time.Instant;
import java.util.Optional;

import org.springframework.stereotype.Repository;

import com.fengmotion.server.chat.store.ChatMessageIdempotencyRepository;
import com.fengmotion.server.chat.store.mapper.ChatMessageIdempotencyMapper;
import com.fengmotion.server.chat.store.mapper.ChatMessageIdempotencyRow;

import lombok.RequiredArgsConstructor;

/**
 * 使用 MyBatis 保存发消息的幂等记录。
 *
 * <p>本类不声明事务边界；写入与消息插入由 {@code ChatMessageService} 放在同一个事务里，
 * 保证「消息已落库」和「幂等键指向它」一起提交。</p>
 */
@Repository
@RequiredArgsConstructor
public class SqliteChatMessageIdempotencyRepository implements ChatMessageIdempotencyRepository {
    private final ChatMessageIdempotencyMapper mapper;

    @Override
    public Optional<Record> findByKey(String key) {
        return Optional.ofNullable(mapper.findByKey(key)).map(SqliteChatMessageIdempotencyRepository::toRecord);
    }

    @Override
    public void save(String key, String requestHash, String sessionId, String messageId, Instant createdAt) {
        mapper.insert(key, requestHash, sessionId, messageId, createdAt.toString());
    }

    @Override
    public void delete(String key) {
        mapper.deleteByKey(key);
    }

    private static Record toRecord(ChatMessageIdempotencyRow row) {
        return new Record(row.requestHash(), row.sessionId(), row.messageId(),
                Instant.parse(row.createdAt()));
    }
}
