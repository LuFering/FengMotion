package com.fengmotion.server.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Path;
import java.util.List;

class DatabaseMigrationTest {
    @TempDir Path tempDir;

    @Test
    void upgradesOldDatabaseWithoutLosingProjectsAndCanRunTwice() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource("jdbc:sqlite:" + tempDir.resolve("old.db"));
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, genome_id TEXT, target_duration_ms INTEGER, root_path TEXT, created_at TEXT NOT NULL)");
        jdbc.update("INSERT INTO projects (id,name,created_at) VALUES (?,?,?)", "old", "旧项目", "2026-01-01T00:00:00Z");
        DatabaseMigration.migrate(jdbc);
        DatabaseMigration.migrate(jdbc);
        assertEquals("旧项目", jdbc.queryForObject("SELECT name FROM projects WHERE id='old'", String.class));
        assertEquals("2026-01-01T00:00:00Z", jdbc.queryForObject("SELECT updated_at FROM projects WHERE id='old'", String.class));
        assertEquals("old", jdbc.queryForObject("SELECT etag FROM projects WHERE id='old'", String.class));

        // 兼容升级补齐的其余字段使用默认值，旧数据保持不变。
        assertEquals("", jdbc.queryForObject("SELECT tagline FROM projects WHERE id='old'", String.class));
        assertEquals("idea", jdbc.queryForObject("SELECT stage FROM projects WHERE id='old'", String.class));
        assertEquals(0, jdbc.queryForObject("SELECT archived FROM projects WHERE id='old'", Integer.class));

        // 幂等表由迁移创建，且重复执行不会重复定义或丢数据。
        List<String> tables = jdbc.query("SELECT name FROM sqlite_master WHERE type='table'",
                (rs, row) -> rs.getString("name"));
        assertTrue(tables.contains("project_idempotency"));
        assertTrue(tables.contains("chat_messages"));
        assertTrue(tables.contains("chat_message_idempotency"));
    }

    /** 旧库没有场景历史表；升级后自动补建，且不伪造历史数据。 */
    @Test
    void createsSceneVersionsTableOnOldDatabase() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:sqlite:" + tempDir.resolve("scene-versions.db"));
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        // 模拟只有当前场景表的旧库
        jdbc.execute("""
                CREATE TABLE project_scenes (
                    project_id TEXT PRIMARY KEY,
                    version INTEGER NOT NULL,
                    film_json TEXT NOT NULL,
                    task_id TEXT,
                    updated_at TEXT NOT NULL
                )
                """);
        jdbc.execute("""
                CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    request_json TEXT,
                    progress INTEGER NOT NULL DEFAULT 0,
                    message TEXT NOT NULL DEFAULT '',
                    artifact_path TEXT,
                    error_code TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    finished_at TEXT
                )
                """);

        DatabaseMigration.migrate(jdbc);
        DatabaseMigration.migrate(jdbc);

        List<String> tables = jdbc.query("SELECT name FROM sqlite_master WHERE type='table'",
                (rs, row) -> rs.getString("name"));
        assertTrue(tables.contains("project_scene_versions"), "旧库要能补出历史表");
        // 迁移不为已有当前场景编造历史快照：那一版从未被记录过，伪造会误导回退
        assertEquals(0, jdbc.queryForObject(
                "SELECT COUNT(*) FROM project_scene_versions", Integer.class));
    }

    /** 早期只有会话表、没有 soft delete 列的旧库，升级后能保存并读回 deleted_at。 */
    @Test
    void addsDeletedAtToOldChatSessionsTable() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource("jdbc:sqlite:" + tempDir.resolve("chat.db"));
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("""
                CREATE TABLE chat_sessions (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """);
        jdbc.update("INSERT INTO chat_sessions VALUES (?,?,?,?,?)",
                "s-old", "p-old", "旧会话", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");

        DatabaseMigration.migrate(jdbc);
        DatabaseMigration.migrate(jdbc);

        assertEquals("旧会话", jdbc.queryForObject("SELECT title FROM chat_sessions WHERE id='s-old'", String.class));
        // 新列存在且旧记录的值为 NULL：迁移不把已有会话当成已删除。
        assertEquals(1, jdbc.queryForObject(
                "SELECT COUNT(*) FROM chat_sessions WHERE id='s-old' AND deleted_at IS NULL", Integer.class));
    }

    /** 早期会话表没有 harness_session_id 列，升级后能保存并读回该绑定值。 */
    @Test
    void addsHarnessSessionColumnToOldChatSessionsTable() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:sqlite:" + tempDir.resolve("chat-harness.db"));
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("""
                CREATE TABLE chat_sessions (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """);
        jdbc.update("INSERT INTO chat_sessions (id,project_id,title,created_at,updated_at) VALUES (?,?,?,?,?)",
                "old-session", "p1", "旧会话", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");

        DatabaseMigration.migrate(jdbc);
        DatabaseMigration.migrate(jdbc);

        // 旧行的绑定列默认为空：从未调用过引擎的会话不应被编造一个会话标识。
        assertEquals(null, jdbc.queryForObject(
                "SELECT harness_session_id FROM chat_sessions WHERE id='old-session'", String.class));

        jdbc.update("UPDATE chat_sessions SET harness_session_id=? WHERE id=?",
                "fm-bound", "old-session");
        assertEquals("fm-bound", jdbc.queryForObject(
                "SELECT harness_session_id FROM chat_sessions WHERE id='old-session'", String.class));
    }
}
