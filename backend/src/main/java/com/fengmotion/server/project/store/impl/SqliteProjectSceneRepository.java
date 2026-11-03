package com.fengmotion.server.project.store.impl;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.store.ProjectSceneRepository;

import lombok.RequiredArgsConstructor;

/**
 * 项目当前场景的 SQLite 实现。
 *
 * <p><strong>条件更新必须是单条 SQL</strong>：先查版本再写会分成两条语句，
 * 两个并发任务可能都读到 version=1，然后都写成功 —— 后写的静默覆盖前者。
 * 这里用 {@code UPDATE ... WHERE version = ?} 让数据库的写锁与条件判断
 * 成为一次原子操作，受影响行数为 0 即表示版本已变。</p>
 */
@Repository
@RequiredArgsConstructor
public class SqliteProjectSceneRepository implements ProjectSceneRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    @Override
    public Optional<ProjectScene> find(String projectId) {
        List<ProjectScene> rows = jdbc.query(
                "SELECT project_id, version, film_json, task_id, updated_at FROM project_scenes WHERE project_id = ?",
                (rs, i) -> new ProjectScene(
                        rs.getString("project_id"),
                        rs.getLong("version"),
                        readJson(rs.getString("film_json")),
                        rs.getString("task_id"),
                        Instant.parse(rs.getString("updated_at"))),
                projectId);
        return rows.stream().findFirst();
    }

    @Override
    public Optional<Long> updateIfVersionMatches(String projectId, long expectedVersion,
                                                 JsonNode film, String taskId) {
        String now = Instant.now().toString();
        String filmJson = film == null ? "{}" : film.toString();

        if (expectedVersion <= 0) {
            // 期望「还没有场景」：只在确实没有时插入。
            // 用 INSERT OR IGNORE + 主键冲突来判定，避免「先查再插」的竞态。
            int inserted = jdbc.update(
                    "INSERT OR IGNORE INTO project_scenes (project_id, version, film_json, task_id, updated_at) "
                            + "VALUES (?, 1, ?, ?, ?)",
                    projectId, filmJson, taskId, now);
            return inserted == 1 ? Optional.of(1L) : Optional.empty();
        }

        int updated = jdbc.update(
                "UPDATE project_scenes SET version = version + 1, film_json = ?, task_id = ?, updated_at = ? "
                        + "WHERE project_id = ? AND version = ?",
                filmJson, taskId, now, projectId, expectedVersion);
        if (updated == 0) {
            return Optional.empty();
        }
        return find(projectId).map(ProjectScene::version);
    }

    /**
     * 解析存库的 JSON；坏数据不应让整个读取失败。
     *
     * @param raw 文本
     * @return 解析结果；空或坏数据返回 null
     */
    private JsonNode readJson(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return json.readTree(raw);
        } catch (Exception malformed) {
            return null;
        }
    }
}
