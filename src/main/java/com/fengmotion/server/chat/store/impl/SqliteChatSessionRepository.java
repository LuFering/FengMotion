package com.fengmotion.server.chat.store.impl;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Repository;

import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.chat.store.mapper.ChatSessionMapper;
import com.fengmotion.server.chat.store.mapper.ChatSessionRow;

import lombok.RequiredArgsConstructor;

/**
 * 使用 MyBatis 在 SQLite 中保存和查询对话会话。
 *
 * <p>SQL 与结果集映射全部交给 {@link ChatSessionMapper}；本类只负责领域对象
 * 与数据库行之间的转换（{@code Instant} 与 SQLite TEXT 时间）。</p>
 */
@Repository
@RequiredArgsConstructor
public class SqliteChatSessionRepository implements ChatSessionRepository {
    private final ChatSessionMapper mapper;

    @Override
    public void save(ChatSession session) {
        mapper.insert(toRow(session));
    }

    @Override
    public Optional<ChatSession> findById(String id) {
        return Optional.ofNullable(mapper.findById(id)).map(this::toDomain);
    }

    @Override
    public List<ChatSession> findByProjectId(String projectId, int limit, int offset) {
        return mapper.findByProjectId(projectId, limit, offset).stream()
                .map(this::toDomain)
                .toList();
    }

    @Override
    public int softDelete(String id, Instant deletedAt) {
        return mapper.softDelete(id, deletedAt.toString());
    }

    @Override
    public int touch(String id, Instant updatedAt) {
        return mapper.touch(id, updatedAt.toString());
    }

    @Override
    public int bindHarnessSession(String id, String harnessSessionId) {
        return mapper.bindHarnessSession(id, harnessSessionId);
    }

    @Override
    public int updateTitle(String id, String title) {
        return mapper.updateTitle(id, title);
    }

    /** 把领域对象转换为数据库行；时间按既有格式存为 ISO 8601 文本。 */
    private ChatSessionRow toRow(ChatSession session) {
        return new ChatSessionRow(
                session.id(),
                session.projectId(),
                session.title(),
                session.createdAt().toString(),
                session.updatedAt().toString(),
                session.messageCount(),
                session.harnessSessionId());
    }

    /** 把数据库行转换为领域对象，并恢复为 Instant。 */
    private ChatSession toDomain(ChatSessionRow row) {
        return new ChatSession(
                row.id(),
                row.projectId(),
                row.title(),
                Instant.parse(row.createdAt()),
                Instant.parse(row.updatedAt()),
                row.messageCount(),
                row.harnessSessionId());
    }
}
