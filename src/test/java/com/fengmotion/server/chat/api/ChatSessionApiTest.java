package com.fengmotion.server.chat.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 验证会话创建、列表与详情接口的契约：状态码、排序、分页游标与错误信封。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ChatSessionApiTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ChatSessionRepository sessions;

    @Autowired
    private ProjectRepository projects;

    // 归档没有对外接口，测试里直接改标记位来模拟“项目已归档”。
    @Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbc;

    /** 创建成功返回 201 和会话本体（不套信封），messageCount 为 0。 */
    @Test
    void createsSessionWithTitle() throws Exception {
        String projectId = createProject();

        mvc.perform(post("/api/projects/{projectId}/chat-sessions", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                java.util.Map.of("projectId", projectId, "title", "第一个对话"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(jsonPath("$.projectId").value(projectId))
                .andExpect(jsonPath("$.title").value("第一个对话"))
                .andExpect(jsonPath("$.createdAt").isString())
                .andExpect(jsonPath("$.updatedAt").isString())
                // 时间是 ISO 8601 字符串（如 2026-11-01T08:47:51.123Z），不是时间戳数字。
                .andExpect(jsonPath("$.createdAt")
                        .value(org.hamcrest.Matchers.matchesPattern("\\d{4}-\\d{2}-\\d{2}T.*Z")))
                .andExpect(jsonPath("$.updatedAt")
                        .value(org.hamcrest.Matchers.matchesPattern("\\d{4}-\\d{2}-\\d{2}T.*Z")))
                .andExpect(jsonPath("$.messageCount").value(0))
                // 响应体是会话本体，而不是 {data: ...} 或 {error: ...} 信封。
                .andExpect(jsonPath("$.data").doesNotExist())
                .andExpect(jsonPath("$.error").doesNotExist());
    }

    /** 标题为空或未提供时使用默认标题「未命名对话」。 */
    @Test
    void usesDefaultTitleWhenBlankOrMissing() throws Exception {
        String projectId = createProject();

        mvc.perform(post("/api/projects/{projectId}/chat-sessions", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                java.util.Map.of("projectId", projectId, "title", "   "))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("未命名对话"));

        mvc.perform(post("/api/projects/{projectId}/chat-sessions", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"projectId\":\"" + projectId + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("未命名对话"));
    }

    /** 请求体中的项目 ID 与路径不一致时返回 400。 */
    @Test
    void rejectsProjectIdMismatch() throws Exception {
        String projectId = createProject();

        mvc.perform(post("/api/projects/{projectId}/chat-sessions", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                java.util.Map.of("projectId", "other-project", "title", "对话"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_error"));
    }

    /** 为不存在的项目创建会话返回 404。 */
    @Test
    void rejectsUnknownProjectOnCreate() throws Exception {
        String missing = UUID.randomUUID().toString();

        mvc.perform(post("/api/projects/{projectId}/chat-sessions", missing)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                java.util.Map.of("projectId", missing))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    /** 标题超过 40 个字符时返回 400。 */
    @Test
    void rejectsTooLongTitle() throws Exception {
        String projectId = createProject();

        mvc.perform(post("/api/projects/{projectId}/chat-sessions", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                java.util.Map.of("projectId", projectId, "title", "字".repeat(41)))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_error"));
    }

    /** 列表按更新时间倒序，limit 生效并返回可继续翻页的游标。 */
    @Test
    void listsSessionsDescendingWithCursor() throws Exception {
        Instant base = Instant.parse("2026-01-01T10:00:00Z");
        String projectId = createProject();

        ChatSession older = seedSession(projectId, "较早的会话", base, base);
        ChatSession newer = seedSession(projectId, "较新的会话", base, Instant.parse("2026-01-01T11:00:00Z"));
        ChatSession newest = seedSession(projectId, "最新的会话", base, Instant.parse("2026-01-01T12:00:00Z"));

        String firstPage = mvc.perform(get("/api/projects/{projectId}/chat-sessions", projectId)
                        .param("limit", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value(newest.id()))
                .andExpect(jsonPath("$.items[1].id").value(newer.id()))
                .andExpect(jsonPath("$.items[0].messageCount").value(0))
                .andReturn().getResponse().getContentAsString();

        String cursor = objectMapper.readTree(firstPage).get("nextCursor").asText();
        assertNotNull(cursor);
        assertFalse(cursor.isBlank());

        mvc.perform(get("/api/projects/{projectId}/chat-sessions", projectId)
                        .param("limit", "2")
                        .param("cursor", cursor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(older.id()))
                .andExpect(jsonPath("$.nextCursor").isEmpty());
    }

    /** 游标是 URL 安全 Base64 编码的偏移量，与项目列表一致。 */
    @Test
    void cursorIsUrlSafeBase64Offset() throws Exception {
        String projectId = createProject();
        Instant base = Instant.parse("2026-01-01T10:00:00Z");
        for (int i = 0; i < 3; i++) {
            seedSession(projectId, "会话 " + i, base, base.plusSeconds(i));
        }

        String cursor = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("1".getBytes(StandardCharsets.UTF_8));

        mvc.perform(get("/api/projects/{projectId}/chat-sessions", projectId)
                        .param("limit", "1")
                        .param("cursor", cursor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].title").value("会话 1"));
    }

    /** limit 超出 1 至 200 时返回 400 错误信封。 */
    @Test
    void rejectsInvalidLimit() throws Exception {
        String projectId = createProject();

        for (String limit : new String[] {"0", "201"}) {
            mvc.perform(get("/api/projects/{projectId}/chat-sessions", projectId)
                            .param("limit", limit))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("validation_error"));
        }
    }

    /** 偏移量游标超出 int 范围时按非法游标拒绝，而不是溢出后查到错误的页。 */
    @Test
    void rejectsOffsetCursorBeyondIntRange() throws Exception {
        String projectId = createProject();
        String cursor = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("2147483648".getBytes(StandardCharsets.UTF_8));

        mvc.perform(get("/api/projects/{projectId}/chat-sessions", projectId).param("cursor", cursor))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_error"));
    }

    /** 已归档项目按不存在处理：创建和列表都返回 404。 */
    @Test
    void rejectsArchivedProject() throws Exception {
        String projectId = createProject();
        jdbc.update("UPDATE projects SET archived = 1 WHERE id = ?", projectId);

        mvc.perform(post("/api/projects/{projectId}/chat-sessions", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                java.util.Map.of("projectId", projectId))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));

        mvc.perform(get("/api/projects/{projectId}/chat-sessions", projectId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    /** 未知项目的列表返回 404。 */
    @Test
    void rejectsUnknownProjectOnList() throws Exception {
        mvc.perform(get("/api/projects/{projectId}/chat-sessions", UUID.randomUUID().toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    /** 详情返回 200 和会话本体。 */
    @Test
    void getsSessionDetail() throws Exception {
        String projectId = createProject();
        ChatSession session = seedSession(projectId, "详情会话",
                Instant.parse("2026-01-01T10:00:00Z"), Instant.parse("2026-01-01T10:30:00Z"));

        mvc.perform(get("/api/chat-sessions/{sessionId}", session.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(session.id()))
                .andExpect(jsonPath("$.projectId").value(projectId))
                .andExpect(jsonPath("$.title").value("详情会话"))
                .andExpect(jsonPath("$.messageCount").value(0));
    }

    /** 不存在的会话详情返回 404。 */
    @Test
    void returnsNotFoundForUnknownSession() throws Exception {
        mvc.perform(get("/api/chat-sessions/{sessionId}", UUID.randomUUID().toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    private String createProject() {
        Instant now = Instant.parse("2026-01-01T10:00:00Z");
        String projectId = UUID.randomUUID().toString();
        projects.save(new Project(projectId, "测试项目", null, null, null, now));
        return projectId;
    }

    private ChatSession seedSession(String projectId, String title, Instant createdAt, Instant updatedAt) {
        ChatSession session = new ChatSession(
                UUID.randomUUID().toString(), projectId, title, createdAt, updatedAt);
        sessions.save(session);
        return session;
    }
}
