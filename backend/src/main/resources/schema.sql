-- 全新数据库的初始结构。旧库缺少的列由 config.DatabaseMigration 在启动时补齐；
-- 这里所有语句都必须可重复执行（IF NOT EXISTS）。
-- 新库也应一次建全 projects 的列：迁移只补旧库缺的列，不会重跑这里的建表。

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
);

-- 保存属于项目的对话会话。deleted_at 非空表示会话已软删除：
-- 消息仍然保留以供审计，但不再通过接口返回。
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    harness_session_id TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_id);

-- 会话消息只追加、不原地修改（参考 dsh 的 append-only 会话日志）：
-- seq 在会话内严格递增，是消息的稳定顺序与翻页键；
-- references_json / attachments_json 原样保存前端提交的结构化引用和附件元信息；
-- tool_calls_json 保存这条助手回复执行过的工具调用（模型调了哪些工具、参数、成败），
-- 让用户切走会话再回来时还能查到「这条回复当时做了什么」。
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
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq ON chat_messages(session_id, seq);

-- 发消息的幂等记录：同一个 Idempotency-Key 重试时返回同一条消息。
-- session_id 一并保存，用于核对同一把键没有被换到另一个会话上重放。
CREATE TABLE IF NOT EXISTS chat_message_idempotency (
    key TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- 制作任务：一次「用户提交要求 → 执行 → 产出」的完整记录。
-- 任务必须落库而不是只放内存：服务重启后用户还要能看到历史与失败原因。
-- request_json 存原始要求（字段随后续演进可能要加，不为此频繁改表）；
-- artifact_path 指向项目目录里的产物文件（相对路径），空表示还没产出。
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
    -- 场景版本关联：base_version=任务开始时的场景版本，result_version=本次产出并提交的版本。
    -- 两个都留空表示该任务与场景版本无关（如纯渲染）。
    base_version INTEGER,
    result_version INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_created ON tasks(project_id, created_at DESC);

-- 项目当前场景：修改任务的权威基线。
-- 单行一项目（project_id 主键），版本号只在条件更新成功时 +1。
-- 场景整份存 JSON：读写粒度永远是整份，结构演进快于查询需求。
CREATE TABLE IF NOT EXISTS project_scenes (
    project_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    film_json TEXT NOT NULL,
    task_id TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);


-- 任务事件：状态迁移的唯一可观察出口。
-- seq 在任务内严格递增，客户端据此断线重连时补发（Last-Event-ID）。
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
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_seq ON task_events(task_id, seq);
