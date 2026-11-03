package com.fengmotion.server.chat.service;

import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.store.ProjectDataRepository;
import com.fengmotion.server.project.store.ProjectDataRepository.ProjectData;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 验证会话创建与查询的业务规则。 */
class ChatSessionServiceTest {

    // 模拟数据访问对象，测试时不访问数据库。
    private final ChatSessionRepository sessions = mock(ChatSessionRepository.class);
    private final ProjectDataRepository projects = mock(ProjectDataRepository.class);

    // 手动创建 Service，把模拟对象传给构造方法。
    private final ChatSessionService service = new ChatSessionService(sessions, projects);

    /** 标题未提供时，使用默认标题并保存会话。 */
    @Test
    void createsSessionWithDefaultTitle() {
        String projectId = "project-1";

        // 模拟：能查到这个项目。
        when(projects.findActiveById(projectId))
                .thenReturn(Optional.of(mock(ProjectData.class)));

        ChatSession result = service.create(projectId, null);

        assertEquals(projectId, result.projectId());
        assertEquals("未命名对话", result.title());
        assertNotNull(result.id());
        assertNotNull(result.createdAt());
        assertEquals(result.createdAt(), result.updatedAt());

        // 验证传给 save 的对象就是方法返回的对象。
        verify(sessions).save(result);
    }

    /** 项目不存在时返回 404，且不保存会话。 */
    @Test
    void rejectsUnknownProject() {
        String projectId = "missing-project";
        when(projects.findActiveById(projectId)).thenReturn(Optional.empty());

        ApiException error = assertThrows(
                ApiException.class,
                () -> service.create(projectId, "测试对话")
        );

        assertEquals(HttpStatus.NOT_FOUND, error.getStatus());
        assertEquals("not_found", error.getCode());
        verify(sessions, never()).save(org.mockito.ArgumentMatchers.any());
    }

    /** 标题超过 40 个字符时返回 400，且不保存会话。 */
    @Test
    void rejectsTitleLongerThanFortyCharacters() {
        String projectId = "project-1";
        when(projects.findActiveById(projectId))
                .thenReturn(Optional.of(mock(ProjectData.class)));

        String title = "字".repeat(41);

        ApiException error = assertThrows(
                ApiException.class,
                () -> service.create(projectId, title)
        );

        assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
        assertEquals("validation_error", error.getCode());
        verify(sessions, never()).save(org.mockito.ArgumentMatchers.any());
    }

    /** 列表按游标偏移量查询，多取一条时返回下一页游标。 */
    @Test
    void listsSessionsFromCursorOffset() {
        String projectId = "project-1";
        when(projects.findActiveById(projectId))
                .thenReturn(Optional.of(mock(ProjectData.class)));

        ChatSession first = session("s1", projectId, "一");
        ChatSession second = session("s2", projectId, "二");
        ChatSession third = session("s3", projectId, "三");
        // 多取一条（limit + 1 = 3），用于判断是否还有下一页。
        when(sessions.findByProjectId(projectId, 3, 2))
                .thenReturn(List.of(first, second, third));

        String cursor = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("2".getBytes(StandardCharsets.UTF_8));

        ChatSessionService.Page page = service.list(projectId, cursor, 2);

        assertEquals(List.of(first, second), page.items());
        assertEquals(
                Base64.getUrlEncoder().withoutPadding()
                        .encodeToString("4".getBytes(StandardCharsets.UTF_8)),
                page.nextCursor());
    }

    /** 结果不超过 limit 时没有下一页游标。 */
    @Test
    void returnsNullCursorWhenNoMoreSessions() {
        String projectId = "project-1";
        when(projects.findActiveById(projectId))
                .thenReturn(Optional.of(mock(ProjectData.class)));
        when(sessions.findByProjectId(projectId, 51, 0))
                .thenReturn(List.of(session("s1", projectId, "一")));

        ChatSessionService.Page page = service.list(projectId, null, 50);

        assertEquals(1, page.items().size());
        assertNull(page.nextCursor());
    }

    /** 未知项目的会话列表返回 404，且不查询会话表。 */
    @Test
    void rejectsListingUnknownProject() {
        String projectId = "missing-project";
        when(projects.findActiveById(projectId)).thenReturn(Optional.empty());

        ApiException error = assertThrows(
                ApiException.class,
                () -> service.list(projectId, null, 50));

        assertEquals(HttpStatus.NOT_FOUND, error.getStatus());
        assertEquals("not_found", error.getCode());
        verify(sessions, never()).findByProjectId(any(), anyInt(), anyInt());
    }

    /** limit 超出 1 至 200 时返回 400。 */
    @Test
    void rejectsLimitOutOfRange() {
        String projectId = "project-1";
        when(projects.findActiveById(projectId))
                .thenReturn(Optional.of(mock(ProjectData.class)));

        for (int limit : new int[] {0, 201}) {
            ApiException error = assertThrows(
                    ApiException.class,
                    () -> service.list(projectId, null, limit));
            assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
            assertEquals("validation_error", error.getCode());
        }
        verify(sessions, never()).findByProjectId(any(), anyInt(), anyInt());
    }

    /** 游标不是合法 Base64 偏移量时返回 400。 */
    @Test
    void rejectsMalformedCursor() {
        String projectId = "project-1";
        when(projects.findActiveById(projectId))
                .thenReturn(Optional.of(mock(ProjectData.class)));

        ApiException error = assertThrows(
                ApiException.class,
                () -> service.list(projectId, "not-a-cursor!", 50));

        assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
        assertEquals("validation_error", error.getCode());
        verify(sessions, never()).findByProjectId(any(), anyInt(), anyInt());
    }

    /** 查询存在的会话时返回会话。 */
    @Test
    void getsSessionById() {
        ChatSession session = session("s1", "project-1", "一");
        when(sessions.findById("s1")).thenReturn(Optional.of(session));

        assertEquals(session, service.get("s1"));
    }

    /** 查询不存在的会话时返回 404。 */
    @Test
    void rejectsUnknownSession() {
        when(sessions.findById("missing")).thenReturn(Optional.empty());

        ApiException error = assertThrows(
                ApiException.class,
                () -> service.get("missing"));

        assertEquals(HttpStatus.NOT_FOUND, error.getStatus());
        assertEquals("not_found", error.getCode());
    }

    private static ChatSession session(String id, String projectId, String title) {
        Instant time = Instant.parse("2026-01-01T10:00:00Z");
        return new ChatSession(id, projectId, title, time, time);
    }
}
