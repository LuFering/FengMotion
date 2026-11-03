package com.fengmotion.server.chat.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.chat.domain.ChatMessage;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

/**
 * 验证消息的追加、序号分配、JSON 附加字段与键集分页。
 *
 * <p>序号是消息顺序的唯一依据，因此这里重点检查：序号从 1 开始连续递增、
 * 按序号正序读取、{@code afterSeq} 严格大于过滤，以及引用/附件能原样往返。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ChatMessageRepositoryTest {
    private static final Instant BASE = Instant.parse("2026-01-01T10:00:00Z");

    @Autowired
    private ChatMessageRepository messages;

    @Autowired
    private ChatSessionRepository sessions;

    @Autowired
    private ProjectRepository projects;

    @Autowired
    private ObjectMapper json;

    /** 追加两条后序号为 1、2，且能按 ID 读回相同内容。 */
    @Test
    void appendsWithContinuousSequence() {
        String sessionId = createSession();

        ChatMessage first = append(sessionId, "第一条");
        ChatMessage second = append(sessionId, "第二条");

        assertEquals(1, first.seq());
        assertEquals(2, second.seq());
        assertEquals(first, messages.findById(first.id()).orElseThrow());
        assertEquals(2, messages.countBySessionId(sessionId));
    }

    /** 不同会话各自从 1 开始编号，互不影响。 */
    @Test
    void sequencesAreScopedToSession() {
        String sessionA = createSession();
        String sessionB = createSession();

        append(sessionA, "A1");
        append(sessionA, "A2");
        ChatMessage b1 = append(sessionB, "B1");

        assertEquals(1, b1.seq());
        assertEquals(2, messages.countBySessionId(sessionA));
        assertEquals(1, messages.countBySessionId(sessionB));
    }

    /** afterSeq 是严格大于：传本页最后一条的序号，下一页从它的下一条开始。 */
    @Test
    void pagesStrictlyAfterSeq() {
        String sessionId = createSession();
        for (int i = 1; i <= 5; i++) {
            append(sessionId, "消息 " + i);
        }

        assertEquals(List.of("消息 1", "消息 2"),
                texts(messages.findAfterSeq(sessionId, 0, 2)));
        assertEquals(List.of("消息 3", "消息 4"),
                texts(messages.findAfterSeq(sessionId, 2, 2)));
        assertEquals(List.of("消息 5"),
                texts(messages.findAfterSeq(sessionId, 4, 2)));
        assertEquals(List.of(), texts(messages.findAfterSeq(sessionId, 5, 2)));
    }

    /** 引用与附件以 JSON 文本整列保存，读回时结构不变；没有时保持 null。 */
    @Test
    void roundTripsReferencesAndAttachments() throws Exception {
        String sessionId = createSession();
        var references = json.readTree("""
                [{"id":"scene:s01","role":"target","kind":"scene","sceneId":"s01","label":"s01 开场"}]
                """);
        var attachments = json.readTree("""
                [{"name":"参考.png","mimeType":"image/png","sizeBytes":1024,"fileId":"f1"}]
                """);

        ChatMessage saved = messages.append(new ChatMessage(
                UUID.randomUUID().toString(), sessionId, 0, ChatMessage.ROLE_USER, "带引用的消息",
                "task-1", references, attachments, null, BASE));

        ChatMessage found = messages.findById(saved.id()).orElseThrow();
        assertEquals(references, found.references());
        assertEquals(attachments, found.attachments());
        assertEquals("task-1", found.taskId());

        ChatMessage plain = append(sessionId, "没有附加字段");
        assertNull(plain.references());
        assertNull(plain.attachments());
    }

    /**
     * 工具调用记录随消息往返。
     *
     * <p>这条链路是「切走会话再回来还能查到这条回复跑了什么」的唯一依据：
     * 它跨了 JSON 序列化、SQLite 文本列、以及读回时的反序列化三跳，
     * 任何一环丢字段都会让界面上的工具记录凭空消失，且不会报错。</p>
     */
    @Test
    void roundTripsToolCalls() throws Exception {
        String sessionId = createSession();
        // arguments 本身是「JSON 字符串」：JS 端传过来时已经是字符串化的参数，
        // 这里用转义后的引号还原这一层，确保往返不破坏它。
        var toolCalls = json.readTree(
                "[{\"callId\":\"call-1\",\"name\":\"bash\","
                        + "\"arguments\":\"{\\\"command\\\":\\\"ls\\\"}\",\"done\":true},"
                        + "{\"callId\":\"call-2\",\"name\":\"write\","
                        + "\"arguments\":\"{\\\"path\\\":\\\"a.txt\\\"}\","
                        + "\"done\":true,\"isError\":true}]");

        ChatMessage saved = messages.append(new ChatMessage(
                UUID.randomUUID().toString(), sessionId, 0, ChatMessage.ROLE_ASSISTANT,
                "带工具调用的回复", null, null, null, toolCalls, BASE));

        ChatMessage found = messages.findById(saved.id()).orElseThrow();
        assertEquals(toolCalls, found.toolCalls(), "工具调用记录必须原样往返");
        assertEquals("bash", found.toolCalls().get(0).path("name").asText());
        assertTrue(found.toolCalls().get(1).path("isError").asBoolean(),
                "失败标记不能在落库/读回时丢掉");
    }

    /** 没有工具调用时存 null 而不是空数组：读回来仍是「没有」。 */
    @Test
    void storesNullWhenNoToolCalls() {
        String sessionId = createSession();
        ChatMessage plain = append(sessionId, "纯文本回复");
        assertNull(plain.toolCalls());
        assertNull(messages.findById(plain.id()).orElseThrow().toolCalls());
    }

    /** 会话被软删除后消息仍然保留，供审计与恢复。 */
    @Test
    void keepsMessagesAfterSessionSoftDelete() {
        String sessionId = createSession();
        append(sessionId, "删除前的消息");

        sessions.softDelete(sessionId, Instant.now());

        assertTrue(sessions.findById(sessionId).isEmpty());
        assertEquals(List.of("删除前的消息"), texts(messages.findAfterSeq(sessionId, 0, 10)));
    }

    private ChatMessage append(String sessionId, String text) {
        return messages.append(new ChatMessage(
                UUID.randomUUID().toString(), sessionId, 0, ChatMessage.ROLE_USER, text,
                null, null, null, null, BASE));
    }

    private static List<String> texts(List<ChatMessage> rows) {
        return rows.stream().map(ChatMessage::text).toList();
    }

    private String createSession() {
        String projectId = UUID.randomUUID().toString();
        projects.save(new Project(projectId, "消息测试项目", null, null, null, BASE));
        String sessionId = UUID.randomUUID().toString();
        sessions.save(new ChatSession(sessionId, projectId, "消息测试", BASE, BASE));
        return sessionId;
    }
}
