package com.fengmotion.server.project.store;

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
    public java.util.Map<String, JsonNode> findCurrentFilms(List<String> projectIds) {
        if (projectIds.isEmpty()) return java.util.Map.of();
        if (projectIds.size() > 201) throw new IllegalArgumentException("项目摘要批量查询最多201项");
        String placeholders = String.join(",", java.util.Collections.nCopies(projectIds.size(), "?"));
        java.util.Map<String, JsonNode> films = new java.util.HashMap<>();
        jdbc.query("SELECT project_id, film_json FROM project_scenes WHERE project_id IN (" + placeholders + ")",
                (org.springframework.jdbc.core.RowCallbackHandler) row -> {
                    JsonNode film = readJson(row.getString("film_json"));
                    if (film != null) films.put(row.getString("project_id"), film);
                }, projectIds.toArray());
        return java.util.Map.copyOf(films);
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
        int inserted = jdbc.update("""
                INSERT INTO project_scene_versions
                    (project_id, version, film_json, task_id, prompt, edit_summary,
                     artifact_path, source, from_version, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, version) DO NOTHING
                """,
                projectId, version, film == null ? "{}" : film.toString(), taskId,
                prompt == null ? "" : prompt,
                editSummary == null ? "" : editSummary,
                artifactPath,
                source == null ? ProjectSceneVersion.SOURCE_TASK : source,
                fromVersion,
                Instant.now().toString());
        if (inserted != 1) throw new com.fengmotion.server.common.ApiException(org.springframework.http.HttpStatus.CONFLICT,
                "scene_history_conflict", "该版本历史已存在，当前版本与历史均未覆盖；请核对项目版本记录");
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

    @Override
    public Optional<ProjectSceneVersion> findLatestVersionByArtifact(String projectId, String artifactPath) {
        if (artifactPath == null || artifactPath.isBlank()) return Optional.empty();
        List<ProjectSceneVersion> rows = jdbc.query("""
                SELECT project_id, version, film_json, task_id, prompt, edit_summary,
                       artifact_path, source, from_version, created_at
                FROM project_scene_versions
                WHERE project_id = ? AND artifact_path = ?
                ORDER BY version DESC LIMIT 1
                """,
                (resultSet, rowNum) -> mapVersion(resultSet),
                projectId, artifactPath);
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

    @Override
    public Optional<ProjectSceneVersion> findVersionByRenderRequest(String projectId, String requestId) {
        return jdbc.query("""
                SELECT * FROM project_scene_versions WHERE project_id = ? AND source = 'task'
                AND CASE WHEN json_valid(film_json) THEN json_extract(film_json, '$.sourceRenderRequest.requestId') END = ?
                ORDER BY version ASC LIMIT 1
                """, (row, index) -> mapVersion(row), projectId, requestId).stream().findFirst();
    }

    @Override public Optional<ProjectSceneVersion> findVersionByShotCandidate(String projectId,String candidateId) {
        return jdbc.query("""
                SELECT * FROM project_scene_versions WHERE project_id = ? AND source = 'shot_edit'
                AND CASE WHEN json_valid(film_json) THEN json_extract(film_json, '$.shotEdit.candidateId') END = ?
                ORDER BY version ASC LIMIT 1
                """,(row,index)->mapVersion(row),projectId,candidateId).stream().findFirst();
    }

    @Override public Optional<ProjectSceneVersion> findVersionByCreationRequest(String projectId,String requestId) {
        return jdbc.query("""
                SELECT * FROM project_scene_versions WHERE project_id = ? AND source = 'task'
                AND CASE WHEN json_valid(film_json) THEN json_extract(film_json, '$.creationRequestId') END = ?
                ORDER BY version ASC LIMIT 1
                """,(row,index)->mapVersion(row),projectId,requestId).stream().findFirst();
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
