package com.fengmotion.server.config;

import java.util.HashSet;
import java.util.Set;
import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 启动期数据库结构迁移：为早期创建的 SQLite 数据库补齐列与表，重复启动时保留已有数据。
 *
 * <p>本类保留 {@link JdbcTemplate}，<strong>仅用于启动期 DDL / PRAGMA / 数据回填</strong>，
 * 不参与任何业务数据访问；业务读写统一由 MyBatis / MyBatis-Plus Mapper 执行。
 * 选择 JdbcTemplate 执行迁移的原因：{@code PRAGMA table_info}、{@code ALTER TABLE}、
 * {@code CREATE TABLE IF NOT EXISTS} 属于启动期结构变更，需要逐条判断并按存在性执行，
 * 用 Mapper 包装只会增加映射与初始化顺序的复杂度，并不会带来事务或可重复执行上的收益。</p>
 *
 * <p>全新数据库的结构由 {@code schema.sql} 建出；本类只补旧库缺的部分，因此两处都需要
 * 新增同一张表时，迁移也必须能独立完成（旧库不会重跑 schema.sql 的建表语句）。</p>
 *
 * <p>执行顺序：{@link DependsOnDatabaseInitialization} 保证本组件在 {@code schema.sql}
 * 初始化完成之后创建；构造函数中的迁移在同一个事务内完成。所有语句均可重复执行。</p>
 */
@Component
@DependsOnDatabaseInitialization
public class DatabaseMigration {
    public DatabaseMigration(JdbcTemplate jdbc, TransactionTemplate transactions) {
        transactions.executeWithoutResult(status -> migrate(jdbc));
    }

    /**
     * 对给定数据源执行幂等的结构兼容升级。
     *
     * <p>保留静态入口便于用真实 SQLite 临时库直接验证迁移；业务代码不应调用本方法。</p>
     *
     * @param jdbc 启动期迁移专用的 JdbcTemplate
     */
    public static void migrate(JdbcTemplate jdbc) {
        // 先确保表存在：全新库、旧库、以及只有部分表的库都能被同一套迁移收敛。
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    genome_id TEXT,
                    target_duration_ms INTEGER,
                    root_path TEXT,
                    created_at TEXT NOT NULL,
                    tagline TEXT NOT NULL DEFAULT '',
                    stage TEXT NOT NULL DEFAULT 'idea',
                    updated_at TEXT,
                    archived INTEGER NOT NULL DEFAULT 0,
                    archived_at TEXT,
                    etag TEXT
                )
                """);
        Set<String> columns = new HashSet<>(jdbc.query("PRAGMA table_info(projects)",
                (rs, row) -> rs.getString("name")));
        if (!columns.contains("tagline")) jdbc.execute("ALTER TABLE projects ADD COLUMN tagline TEXT NOT NULL DEFAULT ''");
        if (!columns.contains("stage")) jdbc.execute("ALTER TABLE projects ADD COLUMN stage TEXT NOT NULL DEFAULT 'idea'");
        if (!columns.contains("updated_at")) jdbc.execute("ALTER TABLE projects ADD COLUMN updated_at TEXT");
        if (!columns.contains("archived")) jdbc.execute("ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
        if (!columns.contains("archived_at")) jdbc.execute("ALTER TABLE projects ADD COLUMN archived_at TEXT");
        if (!columns.contains("etag")) jdbc.execute("ALTER TABLE projects ADD COLUMN etag TEXT");
        jdbc.update("UPDATE projects SET updated_at = created_at WHERE updated_at IS NULL");
        jdbc.update("UPDATE projects SET etag = id WHERE etag IS NULL");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS project_idempotency (
                    key TEXT PRIMARY KEY,
                    request_hash TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """);

        // 会话模块：旧库的 chat_sessions 没有 deleted_at，也没有消息表与发消息幂等表。
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT,
                    FOREIGN KEY (project_id) REFERENCES projects(id)
                )
                """);
        Set<String> sessionColumns = new HashSet<>(jdbc.query("PRAGMA table_info(chat_sessions)",
                (rs, row) -> rs.getString("name")));
        if (!sessionColumns.contains("deleted_at")) {
            jdbc.execute("ALTER TABLE chat_sessions ADD COLUMN deleted_at TEXT");
        }
        // 会话与 DSH 持久会话的绑定列：旧库补列，新库由 schema.sql 建出。
        if (!sessionColumns.contains("harness_session_id")) {
            jdbc.execute("ALTER TABLE chat_sessions ADD COLUMN harness_session_id TEXT");
        }
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_id)");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    text TEXT NOT NULL,
                    task_id TEXT,
                    references_json TEXT,
                    attachments_json TEXT,
                    tool_calls_json TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES chat_sessions(id),
                    UNIQUE (session_id, seq)
                )
                """);
        // 工具调用记录列：旧库补列，新库由上面的建表语句直接带出。
        // 存 JSON 文本而不单开一张表，理由与 references/attachments 相同 ——
        // 它只跟随消息整体读写，没有独立查询需求。
        Set<String> messageColumns = new HashSet<>(jdbc.query("PRAGMA table_info(chat_messages)",
                (rs, row) -> rs.getString("name")));
        if (!messageColumns.contains("tool_calls_json")) {
            jdbc.execute("ALTER TABLE chat_messages ADD COLUMN tool_calls_json TEXT");
        }
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq ON chat_messages(session_id, seq)");
        // 任务域：任务主表与事件表。旧库没有，新库由这里补出。
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
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
                    finished_at TEXT,
                    FOREIGN KEY (project_id) REFERENCES projects(id)
                )
                """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_tasks_project_created ON tasks(project_id, created_at DESC)");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS task_events (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    message TEXT NOT NULL DEFAULT '',
                    data_json TEXT,
                    at TEXT NOT NULL,
                    FOREIGN KEY (task_id) REFERENCES tasks(id),
                    UNIQUE (task_id, seq)
                )
                """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_task_events_task_seq ON task_events(task_id, seq)");
        // 项目当前场景表：旧库补建，新库由 schema.sql 建出。
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS project_scenes (
                    project_id TEXT PRIMARY KEY,
                    version INTEGER NOT NULL,
                    film_json TEXT NOT NULL,
                    task_id TEXT,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id)
                )
                """);
        // 场景历史版本表：旧库补建，新库由 schema.sql 建出。
        // 从旧库升级上来的项目，当前版本还没有对应快照 —— 迁移不伪造历史，
        // 由读取侧把「当前版本缺快照」当作正常情况处理（第一个快照从下次提交开始）。
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS project_scene_versions (
                    project_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    film_json TEXT NOT NULL,
                    task_id TEXT,
                    prompt TEXT NOT NULL DEFAULT '',
                    edit_summary TEXT NOT NULL DEFAULT '',
                    artifact_path TEXT,
                    source TEXT NOT NULL DEFAULT 'task',
                    from_version INTEGER,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id),
                    PRIMARY KEY (project_id, version)
                )
                """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_scene_versions_project_version "
                + "ON project_scene_versions(project_id, version DESC)");
        // 任务上的场景版本关联：可追溯「这次任务基于哪一版、产出了哪一版」。
        Set<String> taskColumns = new HashSet<>(jdbc.query("PRAGMA table_info(tasks)",
                (rs, row) -> rs.getString("name")));
        if (!taskColumns.contains("base_version")) {
            jdbc.execute("ALTER TABLE tasks ADD COLUMN base_version INTEGER");
        }
        if (!taskColumns.contains("result_version")) {
            jdbc.execute("ALTER TABLE tasks ADD COLUMN result_version INTEGER");
        }
        if (!taskColumns.contains("execution_owner")) {
            jdbc.execute("ALTER TABLE tasks ADD COLUMN execution_owner TEXT");
        }
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS chat_message_idempotency (
                    key TEXT PRIMARY KEY,
                    request_hash TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """);

        // 素材库：五个状态维度各自成列（设计说明见 schema.sql）。
        // 旧库不会重跑 schema.sql 的建表语句，所以这里必须独立建成同样的结构。
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS asset_folders (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """);
        jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_folders_name ON asset_folders(name)");
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    media_type TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    source_type TEXT NOT NULL,
                    processing_status TEXT NOT NULL,
                    processing_error TEXT,
                    review_status TEXT NOT NULL,
                    availability TEXT NOT NULL,
                    license_status TEXT NOT NULL,
                    license_details TEXT,
                    width INTEGER,
                    height INTEGER,
                    duration_ms INTEGER,
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    folder_id TEXT,
                    storage_path TEXT NOT NULL,
                    thumbnail_path TEXT,
                    content_hash TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_used_at TEXT,
                    etag TEXT NOT NULL,
                    demo INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (folder_id) REFERENCES asset_folders(id)
                )
                """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder_id)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_assets_media_type ON assets(media_type)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_assets_review_status ON assets(review_status)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_assets_last_used ON assets(last_used_at DESC)");
        jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_content_hash "
                + "ON assets(content_hash) WHERE content_hash IS NOT NULL");
        // 资源引用关系：删除前据此判断 409，不静默级联。
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS resource_refs (
                    resource_kind TEXT NOT NULL,
                    resource_id TEXT NOT NULL,
                    ref_kind TEXT NOT NULL,
                    ref_id TEXT NOT NULL,
                    ref_label TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (resource_kind, resource_id, ref_kind, ref_id)
                )
                """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_resource_refs_target "
                + "ON resource_refs(ref_kind, ref_id)");
    }
}
