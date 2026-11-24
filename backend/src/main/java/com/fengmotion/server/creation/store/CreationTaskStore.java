package com.fengmotion.server.creation.store;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;

/**
 * 创作任务与请求关系（任务幂等、防重复执行与结果落盘关联）的数据持久化。
 */
@Component
@RequiredArgsConstructor
public class CreationTaskStore {

    private final JdbcTemplate jdbc;

    private static final RowMapper<Record> MAPPER = (rs, rowNum) -> new Record(
            rs.getString("request_id"),
            rs.getString("project_id"),
            rs.getString("session_id"),
            rs.getString("user_message_id"),
            rs.getString("request_hash"),
            rs.getString("status"),
            rs.getString("phase"),
            rs.getString("intent"),
            rs.getString("reply"),
            rs.getString("artifact_path"),
            rs.getObject("version") == null ? null : rs.getLong("version"),
            rs.getString("error_message"),
            rs.getInt("session_saved") == 1,
            Instant.parse(rs.getString("created_at")),
            Instant.parse(rs.getString("updated_at"))
    );

    public Optional<Record> findByRequestId(String requestId) {
        if (requestId == null || requestId.isBlank()) return Optional.empty();
        try {
            Record record = jdbc.queryForObject(
                    "SELECT * FROM workflow_creation_tasks WHERE request_id = ?",
                    MAPPER,
                    requestId
            );
            return Optional.ofNullable(record);
        } catch (EmptyResultDataAccessException e) {
            return Optional.empty();
        }
    }

    public List<Record> findByProjectId(String projectId) {
        return jdbc.query(
                "SELECT * FROM workflow_creation_tasks WHERE project_id = ? ORDER BY created_at DESC",
                MAPPER,
                projectId
        );
    }

    /**
     * 按 <strong>项目 + 会话</strong> 取该会话的真实创作轮次。
     *
     * <p>刷新恢复必须按会话查：只按项目查会拿到「项目最近一次」，
     * 而它可能属于另一个会话 —— 那样恢复出来的结论会落到错误的会话作用域里。</p>
     *
     * <p>按创建时间正序返回，便于逐条回填。</p>
     *
     * @param projectId 项目 ID
     * @param sessionId 会话 ID
     * @return 该会话的创作任务
     */
    public List<Record> findByProjectAndSession(String projectId, String sessionId) {
        if (projectId == null || projectId.isBlank()
                || sessionId == null || sessionId.isBlank()) {
            return List.of();
        }
        return jdbc.query(
                """
                SELECT * FROM workflow_creation_tasks
                WHERE project_id = ? AND session_id = ?
                ORDER BY created_at ASC
                """,
                MAPPER,
                projectId, sessionId
        );
    }

    public List<Record> findUnsavedByProjectId(String projectId, String sessionId) {
        if (sessionId != null && !sessionId.isBlank()) {
            return jdbc.query(
                    """
                    SELECT * FROM workflow_creation_tasks
                    WHERE project_id = ? AND session_id = ? AND session_saved = 0
                      AND reply IS NOT NULL AND reply != ''
                      AND status IN ('edited', 'rendered', 'completed', 'awaiting_info')
                    ORDER BY created_at ASC
                    """,
                    MAPPER,
                    projectId, sessionId
            );
        }
        return jdbc.query(
                """
                SELECT * FROM workflow_creation_tasks
                WHERE project_id = ? AND session_saved = 0
                  AND reply IS NOT NULL AND reply != ''
                  AND status IN ('edited', 'rendered', 'completed', 'awaiting_info')
                ORDER BY created_at ASC
                """,
                MAPPER,
                projectId
        );
    }

    public void insert(String requestId, String projectId, String sessionId, String userMessageId,
                       String requestHash, String status, String phase, String intent) {
        Instant now = Instant.now();
        jdbc.update(
                """
                INSERT INTO workflow_creation_tasks (
                    request_id, project_id, session_id, user_message_id, request_hash,
                    status, phase, intent, reply, artifact_path, version, error_message,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
                """,
                requestId, projectId, sessionId, userMessageId, requestHash,
                status, phase, intent, now.toString(), now.toString()
        );
    }

    public void updatePhase(String requestId, String phase) {
        Instant now = Instant.now();
        jdbc.update(
                "UPDATE workflow_creation_tasks SET phase = ?, updated_at = ? WHERE request_id = ?",
                phase, now.toString(), requestId
        );
    }

    public void updateCompleted(String requestId, String status, String phase, String reply,
                                String artifactPath, Long version) {
        updateCompleted(requestId, status, phase, reply, artifactPath, version, false);
    }

    public void updateCompleted(String requestId, String status, String phase, String reply,
                                String artifactPath, Long version, boolean sessionSaved) {
        Instant now = Instant.now();
        jdbc.update(
                """
                UPDATE workflow_creation_tasks
                SET status = ?, phase = ?, reply = ?, artifact_path = ?, version = ?,
                    session_saved = ?, updated_at = ?
                WHERE request_id = ?
                """,
                status, phase, reply, artifactPath, version, sessionSaved ? 1 : 0, now.toString(), requestId
        );
    }

    public void updateSessionSaved(String requestId, boolean sessionSaved) {
        Instant now = Instant.now();
        jdbc.update(
                "UPDATE workflow_creation_tasks SET session_saved = ?, updated_at = ? WHERE request_id = ?",
                sessionSaved ? 1 : 0, now.toString(), requestId
        );
    }

    public void updateFailed(String requestId, String errorMessage) {
        Instant now = Instant.now();
        jdbc.update(
                """
                UPDATE workflow_creation_tasks
                SET status = 'failed', phase = 'failed', error_message = ?, updated_at = ?
                WHERE request_id = ?
                """,
                errorMessage, now.toString(), requestId
        );
    }

    public record Record(
            String requestId,
            String projectId,
            String sessionId,
            String userMessageId,
            String requestHash,
            String status,
            String phase,
            String intent,
            String reply,
            String artifactPath,
            Long version,
            String errorMessage,
            boolean sessionSaved,
            Instant createdAt,
            Instant updatedAt
    ) {
    }
}
