package com.fengmotion.server.project.store.impl;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
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
        return writeCurrentScene(projectId, expectedVersion, film, taskId);
    }

    /**
     * 条件写入当前场景，并在同一事务内补写该版本的历史快照。
     *
     * <p>为什么用 {@code @Transactional} 包住而不是分成两个仓储方法：
     * 条件更新成功、快照写入失败时，必须一起回滚。否则当前版本号已经推进，
     * 但那一版在历史里查不到 —— 用户点回退时列表里缺一版，
     * 且这个缺口无法事后补齐（film 已被下一次写入覆盖）。</p>
     *
     * <p>快照的版本号取自<strong>实际写入成功的版本号</strong>，
     * 而不是自己算出来的 {@code expectedVersion + 1}，
     * 这样与 {@code project_scenes} 里的事实永远一致。</p>
     */
    @Override
    @Transactional
    public Optional<Long> commitWithSnapshot(String projectId, long expectedVersion, JsonNode film, String taskId,
                                             String prompt, String editSummary, String artifactPath,
                                             String source, Long fromVersion) {
        Optional<Long> committed = writeCurrentScene(projectId, expectedVersion, film, taskId);
        if (committed.isEmpty()) {
            // 版本已变：不写快照。这次的内容没有生效，不该出现在历史里。
            return Optional.empty();
        }
        long version = committed.get();
        /* 用 INSERT OR REPLACE 而非普通 INSERT：
           同一版本被写入两次说明上游逻辑有问题，但历史表不该因此让整个任务失败。
           覆盖成最新内容至少保持「历史与当前一致」，比抛异常留一个半截事务要好。
           真正的不变量由 (project_id, version) 主键保证 —— 不会出现两行同号版本。 */
        jdbc.update("""
                INSERT OR REPLACE INTO project_scene_versions
                    (project_id, version, film_json, task_id, prompt, edit_summary,
                     artifact_path, source, from_version, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                projectId, version, film == null ? "{}" : film.toString(), taskId,
                prompt == null ? "" : prompt,
                editSummary == null ? "" : editSummary,
                artifactPath,
                source == null ? ProjectSceneVersion.SOURCE_TASK : source,
                fromVersion,
                Instant.now().toString());
        return committed;
    }

    @Override
    public List<ProjectSceneVersion> listVersions(String projectId) {
        return jdbc.query("""
                SELECT project_id, version, film_json, task_id, prompt, edit_summary,
                       artifact_path, source, from_version, created_at
                FROM project_scene_versions WHERE project_id = ? ORDER BY version DESC
                """,
                (rs, i) -> mapVersion(rs),
                projectId);
    }

    @Override
    public Optional<ProjectSceneVersion> findVersion(String projectId, long version) {
        List<ProjectSceneVersion> rows = jdbc.query("""
                SELECT project_id, version, film_json, task_id, prompt, edit_summary,
                       artifact_path, source, from_version, created_at
                FROM project_scene_versions WHERE project_id = ? AND version = ?
                """,
                (rs, i) -> mapVersion(rs),
                projectId, version);
        return rows.stream().findFirst();
    }

    /**
     * 把一行结果映射成历史版本。
     *
     * @param rs 结果集
     * @return 版本对象
     * @throws java.sql.SQLException 读取失败
     */
    private ProjectSceneVersion mapVersion(java.sql.ResultSet rs) throws java.sql.SQLException {
        long fromVersionRaw = rs.getLong("from_version");
        // wasNull() 必须紧跟在 getLong 之后：它描述的是「最后一次读取」是否为空，
        // 中间插一次读取就会读错对象。
        boolean fromVersionNull = rs.wasNull();
        return new ProjectSceneVersion(
                rs.getString("project_id"),
                rs.getLong("version"),
                readJson(rs.getString("film_json")),
                rs.getString("task_id"),
                rs.getString("prompt"),
                rs.getString("edit_summary"),
                rs.getString("artifact_path"),
                rs.getString("source"),
                fromVersionNull ? null : fromVersionRaw,
                Instant.parse(rs.getString("created_at")));
    }

    /**
     * 只写当前场景的条件更新，不碰历史表。
     *
     * <p>单独提出是因为 {@link #updateIfVersionMatches} 与
     * {@link #commitWithSnapshot} 都要用，且两者对事务的要求不同：
     * 前者保持原有行为（无快照），后者在事务里额外补写快照。</p>
     *
     * @param projectId       项目 ID
     * @param expectedVersion 期望版本
     * @param film            新场景
     * @param taskId          产生该版本的任务
     * @return 新版本号；版本已变时为空
     */
    private Optional<Long> writeCurrentScene(String projectId, long expectedVersion,
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
