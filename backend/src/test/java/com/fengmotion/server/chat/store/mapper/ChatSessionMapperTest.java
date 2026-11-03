package com.fengmotion.server.chat.store.mapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

/**
 * 验证 chat_sessions 的 MyBatis 映射：SQL、列名到 record 的映射与排序。
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ChatSessionMapperTest {
    @Autowired
    private ChatSessionMapper mapper;

    @Autowired
    private ChatSessionRepository sessions;

    @Autowired
    private ProjectRepository projects;

    /** 仓储保存后，Mapper 能按 ID 读出时间仍为 ISO 8601 文本的原始行。 */
    @Test
    void findSessionRowById() {
        Instant now = Instant.parse("2026-01-01T10:00:00Z");
        String projectId = createProject(now);
        String sessionId = UUID.randomUUID().toString();

        sessions.save(new ChatSession(
                sessionId, projectId, "MyBatis 测试", now, now));

        ChatSessionRow row = mapper.findById(sessionId);

        assertEquals(sessionId, row.id());
        assertEquals(projectId, row.projectId());
        assertEquals("MyBatis 测试", row.title());
        assertEquals(now.toString(), row.createdAt());
        assertEquals(now.toString(), row.updatedAt());
    }

    /** 没有匹配记录时，Mapper 返回 null。 */
    @Test
    void returnsNullWhenSessionDoesNotExist() {
        assertNull(mapper.findById(UUID.randomUUID().toString()));
    }

    /**
     * 列表按真实时间倒序，而不是按 ISO 文本比较。
     *
     * <p>同一秒内的 {@code 10:00:00.500Z} 在字符串序中小于 {@code 10:00:00Z}，
     * 只有按 julianday 比较才能排在前面；同一时间的记录按 id 升序稳定排序。</p>
     */
    @Test
    void ordersByActualTimestampAndId() {
        Instant base = Instant.parse("2026-01-01T10:00:00Z");
        Instant later = Instant.parse("2026-01-01T10:00:00.500Z");
        String projectId = createProject(base);
        String otherProjectId = createProject(base);

        String newerId = "b-session";
        String olderId = "c-session";
        String tieId = "a-session";

        sessions.save(new ChatSession(olderId, projectId, "较早", base, base));
        sessions.save(new ChatSession(newerId, projectId, "较新", base, later));
        sessions.save(new ChatSession(tieId, projectId, "同一时间", base, later));
        sessions.save(new ChatSession(UUID.randomUUID().toString(), otherProjectId, "其他项目", base, later));

        List<ChatSessionRow> rows = mapper.findByProjectId(projectId, 3, 0);

        // 较新的两条时间相同，按 id 升序；较早的一条排最后。
        assertEquals(List.of(tieId, newerId, olderId),
                rows.stream().map(ChatSessionRow::id).toList());
        // limit/offset 生效：跳过一条后只剩较早的记录。
        assertEquals(List.of(olderId),
                mapper.findByProjectId(projectId, 3, 2).stream()
                        .map(ChatSessionRow::id).toList());
    }

    private String createProject(Instant time) {
        String projectId = UUID.randomUUID().toString();
        projects.save(new Project(
                projectId, "测试项目", null, null, null, time));
        return projectId;
    }
}
