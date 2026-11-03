package com.fengmotion.server.chat.service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.common.Pagination;
import com.fengmotion.server.project.store.ProjectDataRepository;

import lombok.RequiredArgsConstructor;

/**
 * 对话会话业务服务。
 */
@Service
@RequiredArgsConstructor
public class ChatSessionService {
    private final ChatSessionRepository sessions;
    private final ProjectDataRepository projects;

    /**
     * 在指定项目下创建会话。
     *
     * @param projectId 所属项目 ID
     * @param title     可选标题；为空时使用默认标题
     * @return 新创建的会话
     */
    public ChatSession create(String projectId, String title) {
        // 不允许为不存在或已归档的项目创建会话。
        requireActiveProject(projectId);

        String actualTitle = title == null || title.isBlank() ? "未命名对话" : title.trim();

        if (actualTitle.length() > 40) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "validation_error",
                    "会话标题不能超过 40 个字符");
        }

        Instant now = Instant.now();

        ChatSession session = new ChatSession(
                UUID.randomUUID().toString(),
                projectId,
                actualTitle,
                now,
                now);

        sessions.save(session);
        return session;
    }

    /**
     * 查询指定项目下的会话，按最近更新倒序分页。
     *
     * <p>游标与项目列表一致，是经 URL 安全 Base64 编码的偏移量。多取一条记录
     * 判断是否还有下一页，避免额外的 count 查询。</p>
     *
     * @param projectId 项目 ID
     * @param cursor    上一页返回的游标；首次查询可不传
     * @param limit     每页数量，范围为 1 至 200
     * @return 当前页会话及下一页游标；没有下一页时游标为 null
     * @throws ApiException 项目不存在时 404；分页参数无效时 400
     */
    public Page list(String projectId, String cursor, int limit) {
        // 会话不跨项目：先确认项目存在且未归档，未知项目按 404 处理。
        requireActiveProject(projectId);

        Pagination.requireValidLimit(limit, "会话查询参数无效");
        int offset = Pagination.decodeOffsetCursor(cursor, "会话查询参数无效");
        List<ChatSession> rows = sessions.findByProjectId(projectId, limit + 1, offset);

        boolean more = rows.size() > limit;
        String next = more ? Pagination.encodeCursor(offset + limit) : null;
        return new Page(more ? rows.subList(0, limit) : rows, next);
    }

    /**
     * 查询单个会话。
     *
     * @param sessionId 会话 ID
     * @return 会话
     * @throws ApiException 会话不存在时抛出 404
     */
    public ChatSession get(String sessionId) {
        return sessions.findById(sessionId)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.NOT_FOUND,
                        "not_found",
                        "会话不存在"));
    }

    /**
     * 删除会话（软删除）。
     *
     * <p>契约 agent.md §5：删除会话**不取消**其任务，服务端保留消息与审计记录，
     * 只是不再通过接口返回。因此这里只写入 {@code deleted_at}，不删消息行。</p>
     *
     * @param sessionId 会话 ID
     * @throws ApiException 会话不存在或已删除时抛出 404
     */
    public void delete(String sessionId) {
        int changed = sessions.softDelete(sessionId, Instant.now());
        if (changed == 0) {
            throw new ApiException(
                    HttpStatus.NOT_FOUND,
                    "not_found",
                    "会话不存在");
        }
    }

    /** 校验项目存在且未归档；否则抛出 404。 */
    private void requireActiveProject(String projectId) {
        if (projects.findActiveById(projectId).isEmpty()) {
            throw new ApiException(
                    HttpStatus.NOT_FOUND,
                    "not_found",
                    "项目不存在");
        }
    }

    /**
     * 一页会话查询结果。
     *
     * @param items      当前页会话
     * @param nextCursor 下一页游标；没有更多结果时为 null
     */
    public record Page(List<ChatSession> items, String nextCursor) {
    }
}
