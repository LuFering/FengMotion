package com.fengmotion.server.chat.store;

import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 验证会话在测试数据库中的保存与查询。 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ChatSessionRepositoryTest {

    @Autowired
    private ChatSessionRepository sessions;

    @Autowired
    private ProjectRepository projects;

    /** 仓储保存会话后，能根据 ID 读取相同的数据。 */
    @Test
    void savesAndFindsSession() {
        Instant time = Instant.parse("2026-01-01T10:00:00Z");
        String projectId = UUID.randomUUID().toString();

        // 先创建所属项目，满足会话和项目之间的关联。
        projects.save(new Project(
                projectId, "测试项目", null, null, null, time
        ));

        ChatSession session = new ChatSession(
                UUID.randomUUID().toString(),
                projectId,
                "测试对话",
                time,
                time
        );

        sessions.save(session);

        ChatSession found = sessions.findById(session.id()).orElseThrow();
        assertEquals(session, found);
    }

    /** 生产路径注入的是 MyBatis 实现，而不是其他学习用实现。 */
    @Test
    void usesMyBatisBackedImplementation() {
        // Spring 可能为仓储生成 CGLIB 代理，取目标类再比较。
        assertEquals(
                com.fengmotion.server.chat.store.impl.SqliteChatSessionRepository.class,
                org.springframework.aop.support.AopUtils.getTargetClass(sessions));
    }

    /** Instant 的纳秒精度经过 SQLite TEXT 存取后保持不变。 */
    @Test
    void roundTripsInstantWithNanosecondPrecision() {
        String projectId = UUID.randomUUID().toString();
        Instant time = Instant.parse("2026-01-01T10:00:00Z");
        projects.save(new Project(projectId, "测试项目", null, null, null, time));
        Instant precise = Instant.parse("2026-01-01T10:00:00.123456789Z");

        ChatSession session = new ChatSession(
                UUID.randomUUID().toString(), projectId, "高精度时间", precise, precise);
        sessions.save(session);

        assertEquals(session, sessions.findById(session.id()).orElseThrow());
    }

    /** 查询不存在的会话时返回空结果。 */
    @Test
    void returnsEmptyForUnknownId() {
        assertTrue(sessions.findById(UUID.randomUUID().toString()).isEmpty());
    }

    /** 项目列表只返回对应项目的会话，并按更新时间倒序分页。 */
    @Test
    void listsSessionsByProjectAndPage() {
        Instant firstTime = Instant.parse("2026-01-01T10:00:00Z");
        Instant secondTime = Instant.parse("2026-01-01T11:00:00Z");
        String projectId = UUID.randomUUID().toString();
        String otherProjectId = UUID.randomUUID().toString();

        projects.save(new Project(
                projectId, "项目一", null, null, null, firstTime
        ));
        projects.save(new Project(
                otherProjectId, "项目二", null, null, null, firstTime
        ));

        ChatSession older = new ChatSession(
                UUID.randomUUID().toString(), projectId, "较早的会话",
                firstTime, firstTime
        );
        ChatSession newer = new ChatSession(
                UUID.randomUUID().toString(), projectId, "较新的会话",
                secondTime, secondTime
        );
        ChatSession other = new ChatSession(
                UUID.randomUUID().toString(), otherProjectId, "其他项目的会话",
                secondTime, secondTime
        );

        sessions.save(older);
        sessions.save(newer);
        sessions.save(other);

        assertEquals(
                List.of(newer),
                sessions.findByProjectId(projectId, 1, 0)
        );
        assertEquals(
                List.of(older),
                sessions.findByProjectId(projectId, 1, 1)
        );
    }

    /** 同一毫秒保存的会话按 ID 升序稳定排序，倒序排序靠真实时间而非 ISO 文本。 */
    @Test
    void ordersByTimestampThenIdAscending() {
        String projectId = UUID.randomUUID().toString();
        Instant base = Instant.parse("2026-01-01T14:00:00Z");
        projects.save(new Project(projectId, "测试项目", null, null, null, base));

        // 同一秒内：晚 500ms 的记录字符串比 Z 结尾的记录小，必须按时间排到前面。
        Instant later = Instant.parse("2026-01-01T14:00:00.500Z");
        ChatSession older = new ChatSession(
                "b-older", projectId, "较早", base, base);
        ChatSession tieB = new ChatSession(
                "b-tie", projectId, "同一时间 B", base, later);
        ChatSession tieA = new ChatSession(
                "a-tie", projectId, "同一时间 A", base, later);

        sessions.save(older);
        sessions.save(tieB);
        sessions.save(tieA);

        assertEquals(
                List.of("a-tie", "b-tie", "b-older"),
                sessions.findByProjectId(projectId, 10, 0).stream()
                        .map(ChatSession::id).toList());
    }

    /**
     * 绑定 DSH 会话标识后能被读回；重复绑定同一个值不改变结果。
     *
     * <p>这一列是「多轮对话能续接上下文」的前提：不回写的话每次调用都是全新 DSH 会话。</p>
     */
    @Test
    void bindsHarnessSessionId() {
        Instant time = Instant.parse("2026-01-01T10:00:00Z");
        String projectId = UUID.randomUUID().toString();
        projects.save(new Project(projectId, "绑定测试", null, null, null, time));

        ChatSession session = new ChatSession(
                UUID.randomUUID().toString(), projectId, "对话", time, time);
        sessions.save(session);

        // 新建会话尚未绑定引擎会话。
        assertEquals(null, sessions.findById(session.id()).orElseThrow().harnessSessionId());

        int changed = sessions.bindHarnessSession(session.id(), "fm-" + session.id());
        assertEquals(1, changed);
        assertEquals("fm-" + session.id(),
                sessions.findById(session.id()).orElseThrow().harnessSessionId());

        // 重复绑定同一个值是幂等的（后续轮次会复用同一个标识）。
        sessions.bindHarnessSession(session.id(), "fm-" + session.id());
        assertEquals("fm-" + session.id(),
                sessions.findById(session.id()).orElseThrow().harnessSessionId());
    }
}
