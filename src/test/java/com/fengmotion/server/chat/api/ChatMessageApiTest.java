package com.fengmotion.server.chat.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

/**
 * 验证消息接口与会话删除的契约：状态码、信封、排序、游标与幂等。
 *
 * <p>每个测试都自建项目与会话，避免共享测试库中的其他数据影响断言。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ChatMessageApiTest {
    private static final Instant BASE = Instant.parse("2026-01-01T10:00:00Z");

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ChatSessionRepository sessions;

    @Autowired
    private ProjectRepository projects;

    @Autowired
    private JdbcTemplate jdbc;

    /** 发送消息返回 202 + { message }，消息本体带真实序号与用户角色。 */
    @Test
    void sendsMessageWithAcceptedEnvelope() throws Exception {
        String sessionId = createSession();

        mvc.perform(post("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"把开场字幕改成两行\"}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.message.id").isNotEmpty())
                .andExpect(jsonPath("$.message.sessionId").value(sessionId))
                .andExpect(jsonPath("$.message.role").value("user"))
                .andExpect(jsonPath("$.message.text").value("把开场字幕改成两行"))
                .andExpect(jsonPath("$.message.createdAt").isString())
                // 任务域未接入：信封里没有 taskId，而不是 null。
                .andExpect(jsonPath("$.taskId").doesNotExist())
                // 返回的是 { message } 信封，不是裸消息。
                .andExpect(jsonPath("$.message.seq").doesNotExist())
                .andExpect(jsonPath("$.error").doesNotExist());
    }

    /** 引用与附件原样保存并原样返回；没有内容时字段不出现。 */
    @Test
    void roundTripsReferencesAndAttachments() throws Exception {
        String sessionId = createSession();
        String body = """
                {
                  "text": "把开场字幕改成两行",
                  "references": [{ "id": "scene:s01", "role": "target", "kind": "scene", "sceneId": "s01", "label": "s01 开场" }],
                  "attachments": [{ "name": "a.png", "mimeType": "image/png", "sizeBytes": 10, "fileId": "f1" }]
                }
                """;

        mvc.perform(post("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.message.references[0].sceneId").value("s01"))
                .andExpect(jsonPath("$.message.attachments[0].fileId").value("f1"));

        mvc.perform(get("/api/chat-sessions/{sessionId}/messages", sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].references[0].label").value("s01 开场"))
                .andExpect(jsonPath("$.items[0].attachments[0].name").value("a.png"));
    }

    /** 空文本且无附件 → 400 validation_error。 */
    @Test
    void rejectsEmptyMessage() throws Exception {
        String sessionId = createSession();

        mvc.perform(post("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"   \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_error"));
    }

    /** 多个 target 引用 → 400。 */
    @Test
    void rejectsMultipleTargets() throws Exception {
        String sessionId = createSession();
        String body = """
                {"text":"改这两处","references":[
                  {"id":"a","role":"target","kind":"scene","sceneId":"s1","label":"A"},
                  {"id":"b","role":"target","kind":"scene","sceneId":"s2","label":"B"}]}
                """;

        mvc.perform(post("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_error"));
    }

    /** 未知会话发送 → 404；请求体缺失 → 400。 */
    @Test
    void rejectsUnknownSessionAndMissingBody() throws Exception {
        mvc.perform(post("/api/chat-sessions/{sessionId}/messages", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"你好\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));

        String sessionId = createSession();
        mvc.perform(post("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_error"));
    }

    /** 同一幂等键重试返回同一条消息，不会写出两条。 */
    @Test
    void sendIsIdempotent() throws Exception {
        String sessionId = createSession();
        String key = UUID.randomUUID().toString();

        String first = mvc.perform(post("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"同一句话\"}"))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        String second = mvc.perform(post("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"同一句话\"}"))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();

        String firstId = objectMapper.readTree(first).get("message").get("id").asText();
        String secondId = objectMapper.readTree(second).get("message").get("id").asText();
        assertEquals(firstId, secondId);

        mvc.perform(get("/api/chat-sessions/{sessionId}/messages", sessionId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1));

        // 同一把键换内容 → 409。
        mvc.perform(post("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"换一句\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("idempotency_conflict"));
    }

    /** 历史按时间正序返回，limit 生效并给出可续读的游标。 */
    @Test
    void listsMessagesInOrderWithCursor() throws Exception {
        String sessionId = createSession();
        for (int i = 1; i <= 5; i++) {
            send(sessionId, "消息 " + i);
        }

        String firstPage = mvc.perform(get("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .param("limit", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].text").value("消息 1"))
                .andExpect(jsonPath("$.items[1].text").value("消息 2"))
                .andReturn().getResponse().getContentAsString();

        String cursor = objectMapper.readTree(firstPage).get("nextCursor").asText();
        assertNotNull(cursor);

        mvc.perform(get("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .param("limit", "2").param("cursor", cursor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].text").value("消息 3"))
                .andExpect(jsonPath("$.items[1].text").value("消息 4"));

        // 最后一页没有更多，nextCursor 为 null。
        String secondCursor = objectMapper.readTree(mvc.perform(get("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .param("limit", "2").param("cursor", cursor))
                .andReturn().getResponse().getContentAsString()).get("nextCursor").asText();
        mvc.perform(get("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .param("limit", "2").param("cursor", secondCursor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].text").value("消息 5"))
                .andExpect(jsonPath("$.nextCursor").isEmpty());
    }

    /** limit 越界与非法游标 → 400。 */
    @Test
    void rejectsInvalidPaging() throws Exception {
        String sessionId = createSession();

        mvc.perform(get("/api/chat-sessions/{sessionId}/messages", sessionId).param("limit", "201"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_error"));
        mvc.perform(get("/api/chat-sessions/{sessionId}/messages", sessionId).param("cursor", "!!!"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_error"));
    }

    /** 消息写入后会话消息数递增、更新时间刷新，会话列表按最近活动排序。 */
    @Test
    void updatesSessionCountAndUpdatedAt() throws Exception {
        String projectId = createProject();
        ChatSession session = seedSession(projectId, "计数会话", BASE);
        send(session.id(), "你好");
        send(session.id(), "再问一句");

        mvc.perform(get("/api/chat-sessions/{sessionId}", session.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messageCount").value(2))
                .andExpect(jsonPath("$.updatedAt").isString());

        mvc.perform(get("/api/projects/{projectId}/chat-sessions", projectId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(session.id()))
                .andExpect(jsonPath("$.items[0].messageCount").value(2));
    }

    /** 删除会话返回 204；之后详情、历史、发送都按不存在处理，但消息行仍在库里供审计。 */
    @Test
    void deletesSessionAndKeepsMessagesForAudit() throws Exception {
        String sessionId = createSession();
        send(sessionId, "删除前的消息");

        mvc.perform(delete("/api/chat-sessions/{sessionId}", sessionId))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/chat-sessions/{sessionId}", sessionId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
        mvc.perform(get("/api/chat-sessions/{sessionId}/messages", sessionId))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"还能发吗\"}"))
                .andExpect(status().isNotFound());

        // 审计记录保留：消息行没有被物理删除。
        Integer rows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM chat_messages WHERE session_id = ?", Integer.class, sessionId);
        assertEquals(1, rows);

        // 重复删除按不存在处理。
        mvc.perform(delete("/api/chat-sessions/{sessionId}", sessionId))
                .andExpect(status().isNotFound());
    }

    /** 已删除会话不再出现在项目会话列表中。 */
    @Test
    void deletedSessionDisappearsFromProjectList() throws Exception {
        String projectId = createProject();
        ChatSession kept = seedSession(projectId, "保留", BASE);
        ChatSession removed = seedSession(projectId, "删除", BASE.plusSeconds(60));

        mvc.perform(get("/api/projects/{projectId}/chat-sessions", projectId))
                .andExpect(jsonPath("$.items.length()").value(2));

        mvc.perform(delete("/api/chat-sessions/{sessionId}", removed.id()))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/projects/{projectId}/chat-sessions", projectId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(kept.id()));
    }

    /** 回复流在 Agent 未接入时返回 503 agent_unavailable；未知会话先返回 404。 */
    @Test
    void streamReportsAgentUnavailable() throws Exception {
        String sessionId = createSession();

        mvc.perform(get("/api/chat-sessions/{sessionId}/stream", sessionId))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("agent_unavailable"));

        mvc.perform(get("/api/chat-sessions/{sessionId}/stream", UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    /**
     * 回复流必须遵守 Accept: text/event-stream：错误信封不能因内容协商变成 406。
     *
     * <p>前端用这个 Accept 发起请求（streams.ts），若返回 406，界面会把「Agent 未接入」
     * 显示成「服务端不接受请求」，与真实原因不符。</p>
     */
    @Test
    void streamKeepsErrorEnvelopeForEventStreamClients() throws Exception {
        String sessionId = createSession();

        mvc.perform(get("/api/chat-sessions/{sessionId}/stream", sessionId)
                        .accept(MediaType.TEXT_EVENT_STREAM))
                .andExpect(status().isServiceUnavailable())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.error.code").value("agent_unavailable"));
    }

    /** 新会话的消息数为 0，且有消息时计数来自消息表而不是固定值。 */
    @Test
    void countsRealMessages() throws Exception {
        String sessionId = createSession();

        mvc.perform(get("/api/chat-sessions/{sessionId}", sessionId))
                .andExpect(jsonPath("$.messageCount").value(0));

        send(sessionId, "第一条");

        mvc.perform(get("/api/chat-sessions/{sessionId}", sessionId))
                .andExpect(jsonPath("$.messageCount").value(1));
    }

    /** 系统角色不通过接口下发：直接写入一条 system 消息，历史里也看不到。 */
    @Test
    void hidesSystemMessagesFromHistory() throws Exception {
        String sessionId = createSession();
        send(sessionId, "用户消息");
        jdbc.update("""
                INSERT INTO chat_messages (id, session_id, seq, role, text, created_at)
                VALUES (?, ?, ?, 'system', '内部提示', ?)
                """, UUID.randomUUID().toString(), sessionId, 99, BASE.toString());

        String body = mvc.perform(get("/api/chat-sessions/{sessionId}/messages", sessionId))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertTrue(!body.contains("内部提示"), "system 消息不应出现在历史里");
    }

    private void send(String sessionId, String text) throws Exception {
        mvc.perform(post("/api/chat-sessions/{sessionId}/messages", sessionId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(java.util.Map.of("text", text))))
                .andExpect(status().isAccepted());
    }

    private String createProject() {
        String projectId = UUID.randomUUID().toString();
        projects.save(new Project(projectId, "消息测试项目", null, null, null, BASE));
        return projectId;
    }

    private String createSession() {
        return seedSession(createProject(), "消息会话", BASE).id();
    }

    private ChatSession seedSession(String projectId, String title, Instant updatedAt) {
        ChatSession session = new ChatSession(
                UUID.randomUUID().toString(), projectId, title, BASE, updatedAt);
        sessions.save(session);
        return session;
    }
}
