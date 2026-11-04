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
    -- 创建任务的进程身份；旧任务为空时不猜测其执行者。
    execution_owner TEXT,
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


-- 场景历史版本：每个提交过的版本各留一行，供版本列表与回退使用。
--
-- 为什么不复用 project_scenes：那张表刻意只有一行（当前版本），
-- 版本号是条件更新的比较依据。把历史塞进去会破坏「单行即当前」这个前提。
--
-- 为什么存整份 film 而不存 diff：回退必须能把场景还原成某一版的完整内容。
-- 存 diff 需要顺序重放，任一环节缺失都会还原出错误结果，而这里数据量很小。
--
-- (project_id, version) 是主键：同一版本只可能存在一份快照，
-- 重复写入是 bug 而不是覆盖。
-- source 区分「由任务产生」与「由回退产生」，回退记录额外保留 from_version。
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
);

CREATE INDEX IF NOT EXISTS idx_scene_versions_project_version
    ON project_scene_versions(project_id, version DESC);


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


-- ───────────────────────── 素材库（契约 docs/contracts/asset.md） ─────────────────────────
--
-- 五个状态维度各自成列，禁止压成一个 ready：
--   source_type（从哪来） / processing_status（解析到哪步） / review_status（人确认过吗）
--   availability（还能用吗） / license_status（授权，独立于审核）
-- demo 与 source_type 正交：随应用分发的真实文件可以是 builtin，同时其演示用途仍可标 demo。
--
-- storage_path / thumbnail_path 存**相对**存储根的路径，不存绝对路径：
-- 整目录搬迁或换机器后素材仍然可读，也不会把本机用户名写进库。
-- content_hash 是文件内容 SHA-256，用于识别同一文件本体（去重），但不合并
-- 名称/标签/授权这些用户记录。
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
);

CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder_id);
CREATE INDEX IF NOT EXISTS idx_assets_media_type ON assets(media_type);
CREATE INDEX IF NOT EXISTS idx_assets_review_status ON assets(review_status);
CREATE INDEX IF NOT EXISTS idx_assets_last_used ON assets(last_used_at DESC);
-- 内容哈希**不唯一**：文件本体可以去重，但用户记录不该被合并 ——
-- 旧库里完全可能存在两条内容相同、名称/标签/授权不同的记录。
-- 去重靠服务层「按哈希找一条已存在的文件复用」，不靠数据库唯一约束。
CREATE INDEX IF NOT EXISTS idx_assets_content_hash ON assets(content_hash);

CREATE TABLE IF NOT EXISTS asset_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_folders_name ON asset_folders(name);

-- 引用关系：资源被谁用了。多值，不是状态。
-- 删除素材前必须查这张表：有引用则 409 并列出引用方，不能静默级联。
CREATE TABLE IF NOT EXISTS resource_refs (
    resource_kind TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    ref_kind TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    ref_label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (resource_kind, resource_id, ref_kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_resource_refs_target ON resource_refs(ref_kind, ref_id);


-- ───────────────────── 特效库（契约 docs/contracts/library.md §2） ─────────────────────
--
-- 两条不能混的边界：
--   1. exec_type 是**源库声明的能力标签**（runnable/composable/reference），
--      execution_status 才是**本机真实能不能跑**。分开存，界面不得因 execType=runnable
--      就显示「可执行」。默认全部 not-implemented，只有适配器与依赖真实存在才标 available。
--   2. 技法目录是**只读**的（内置/导入/示例），用户收藏与最近浏览另存 f x_user_state，
--      不写进技法表 —— 否则重建目录会把用户状态冲掉。
--
-- 数组字段（aliases/keywords/steps/...）以 JSON 文本存放：技法详情是整体读取的整体展示，
-- 拆成关系表要 join 十几张表才能拼回一条，收益为零。
CREATE TABLE IF NOT EXISTS fx_techniques (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_en TEXT NOT NULL DEFAULT '',
    aliases_json TEXT NOT NULL DEFAULT '[]',
    keywords_json TEXT NOT NULL DEFAULT '[]',
    intent TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    category_label TEXT NOT NULL DEFAULT '',
    scenes_json TEXT NOT NULL DEFAULT '[]',
    anti_scenes_json TEXT NOT NULL DEFAULT '[]',
    exec_type TEXT NOT NULL,
    exec_label TEXT NOT NULL DEFAULT '',
    execution_status TEXT NOT NULL DEFAULT 'not-implemented',
    impl TEXT NOT NULL,
    impl_label TEXT NOT NULL DEFAULT '',
    complexity INTEGER NOT NULL DEFAULT 1,
    input_kinds_json TEXT NOT NULL DEFAULT '[]',
    input_labels_json TEXT NOT NULL DEFAULT '[]',
    input_requirement TEXT NOT NULL DEFAULT '',
    output TEXT NOT NULL DEFAULT '',
    dependencies_json TEXT NOT NULL DEFAULT '[]',
    steps_json TEXT NOT NULL DEFAULT '[]',
    compatibility_json TEXT NOT NULL DEFAULT '[]',
    limitations_json TEXT NOT NULL DEFAULT '[]',
    failures_json TEXT NOT NULL DEFAULT '[]',
    params_json TEXT NOT NULL DEFAULT '[]',
    preview_image_url TEXT NOT NULL DEFAULT '',
    preview_video_url TEXT,
    preview_caption TEXT NOT NULL DEFAULT '',
    related_json TEXT NOT NULL DEFAULT '[]',
    alternatives_json TEXT NOT NULL DEFAULT '[]',
    featured INTEGER NOT NULL DEFAULT 0,
    version TEXT NOT NULL DEFAULT '1.0.0',
    updated_at TEXT NOT NULL,
    demo INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_fx_techniques_category ON fx_techniques(category);
CREATE INDEX IF NOT EXISTS idx_fx_techniques_exec_type ON fx_techniques(exec_type);
CREATE INDEX IF NOT EXISTS idx_fx_techniques_featured ON fx_techniques(featured);

-- 收藏与最近浏览。独立于参考片偏好（reference-preferences 是参考片的，三库不混用）。
CREATE TABLE IF NOT EXISTS fx_user_state (
    technique_id TEXT PRIMARY KEY,
    favorited INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (technique_id) REFERENCES fx_techniques(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fx_user_state_favorited ON fx_user_state(favorited);


-- ─────────────────── 参考片库（契约 docs/contracts/library.md §4–§5） ───────────────────
--
-- 与素材库的关系：参考片的**文件本体复用一个素材记录**（asset_id），不存两份视频。
-- 素材负责「文件在哪、多大、能不能播」，参考片负责「这段视频里有哪些片段值得借鉴」。
--
-- 三条硬约束（来自契约 §4.2，都是为了让界面不撒谎）：
--   1. observation（观察事实）与 inference（模型推断）是两列，必须分开存、分开展示。
--   2. analysis 里 pending=true 的维度**不得填默认值** —— 存空串并置 pending，
--      界面显示「未解析」而不是 0 或「无」。
--   3. 每个分析值记 source（measured 实测 / model 模型 / user 用户填），
--      界面要能区分，不能把模型判断显示成实测事实。
CREATE TABLE IF NOT EXISTS reference_videos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    asset_id TEXT,
    thumbnail_url TEXT,
    -- 视频级解析状态：analyzed / partial / pending
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    demo INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (asset_id) REFERENCES assets(id)
);

CREATE INDEX IF NOT EXISTS idx_reference_videos_status ON reference_videos(status);
CREATE INDEX IF NOT EXISTS idx_reference_videos_asset ON reference_videos(asset_id);

-- 参考片段：一段连续时间范围 + 对它的观察与分析。
-- start_ms/end_ms 用毫秒（契约 README §6：单位统一在适配层转换，界面里的秒不落库）。
CREATE TABLE IF NOT EXISTS reference_segments (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    tags_json TEXT NOT NULL DEFAULT '[]',
    observation TEXT NOT NULL DEFAULT '',
    inference TEXT NOT NULL DEFAULT '',
    suggestion TEXT NOT NULL DEFAULT '',
    -- 六维分析 + 可选的额外维度，结构见 AnalysisValue：
    --   { value, source, confidence, evidence, pending }
    analysis_json TEXT NOT NULL DEFAULT '{}',
    extra_analysis_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (video_id) REFERENCES reference_videos(id) ON DELETE CASCADE,
    UNIQUE (video_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_reference_segments_video ON reference_segments(video_id, idx);

CREATE TABLE IF NOT EXISTS reference_collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 集合成员关系单独成表：一个片段可以在多个集合里，删集合不该删片段。
CREATE TABLE IF NOT EXISTS reference_collection_members (
    collection_id TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (collection_id, segment_id),
    FOREIGN KEY (collection_id) REFERENCES reference_collections(id) ON DELETE CASCADE,
    FOREIGN KEY (segment_id) REFERENCES reference_segments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reference_members_segment ON reference_collection_members(segment_id);

-- 工作区级个人偏好：收藏与最近浏览。
-- 与素材/特效同理，不与其他库的偏好混用；收藏只是个人标记，不代表「已审核/已采用」。
CREATE TABLE IF NOT EXISTS reference_preferences (
    kind TEXT NOT NULL,          -- 'favorite' | 'recent'
    segment_id TEXT NOT NULL,
    marked_at TEXT NOT NULL,
    PRIMARY KEY (kind, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_reference_prefs_kind ON reference_preferences(kind, marked_at DESC);
