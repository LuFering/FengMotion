package com.fengmotion.server.project.store.impl;

import com.fengmotion.server.project.store.ProjectPurgeRepository;

import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * 物理删除的 SQLite 实现。
 *
 * <p>用 {@link JdbcTemplate} 而不是 MyBatis mapper：这里要按固定顺序执行
 * 多张表的删除，一mapper一方法会把顺序藏进方法名里，读代码时反而看不出
 * 「先删子表后删父表」这条约束。写在一个方法里，顺序一眼可见。</p>
 */
@Repository
public class SqliteProjectPurgeRepository implements ProjectPurgeRepository {

    /** 未结束的任务状态：排队、执行、构建。 */
    private static final String RUNNING_STATUSES = "'queued', 'running', 'building'";

    private final JdbcTemplate jdbc;

    public SqliteProjectPurgeRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public int countRunningTasks(String projectId) {
        Integer n = jdbc.query(
                "SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status IN (" + RUNNING_STATUSES + ")",
                rs -> rs.next() ? rs.getInt(1) : 0,
                projectId);
        return n == null ? 0 : n;
    }

    @Override
    public List<String> findRunningTaskLabels(String projectId) {
        return jdbc.query(
                "SELECT id FROM tasks WHERE project_id = ? AND status IN (" + RUNNING_STATUSES + ") LIMIT 5",
                (rs, i) -> rs.getString(1),
                projectId);
    }

    @Override
    public Optional<String> findRootPath(String projectId) {
        return jdbc.query(
                "SELECT root_path FROM projects WHERE id = ?",
                rs -> rs.next() ? Optional.ofNullable(rs.getString(1)) : Optional.<String>empty(),
                projectId);
    }

    /**
     * {@inheritDoc}
     *
     * <p>删除顺序：先子表后父表。SQLite 没开外键强制，顺序错了不报错，
     * 只会留下指向已删项目的孤儿行 —— 那种数据在界面上表现为「会话还在，
     * 但项目没了」。</p>
     *
     * <p>事务边界放在这里而不是服务层：服务层若用同类的私有方法包事务，
     * 调用不经过代理，{@code @Transactional} 会静默失效 —— 那样删到一半失败
     * 就会留下半套数据。</p>
     */
    @Override
    @Transactional
    public int deleteProjectGraph(String projectId) {
        /* 消息挂在会话上，会话挂在项目上：先消息、再会话。 */
        jdbc.update("DELETE FROM chat_messages WHERE session_id IN "
                + "(SELECT id FROM chat_sessions WHERE project_id = ?)", projectId);
        jdbc.update("DELETE FROM chat_sessions WHERE project_id = ?", projectId);

        /* 任务事件挂在任务上。 */
        jdbc.update("DELETE FROM task_events WHERE task_id IN "
                + "(SELECT id FROM tasks WHERE project_id = ?)", projectId);
        jdbc.update("DELETE FROM tasks WHERE project_id = ?", projectId);

        /* 场景版本挂在场景上。 */
        jdbc.update("DELETE FROM project_scene_versions WHERE project_id = ?", projectId);
        jdbc.update("DELETE FROM project_scenes WHERE project_id = ?", projectId);

        /* 资源引用：这张表记的是「资源 ↔ 谁引用它」，没有 project_id 列。
           项目引用素材时写的是 ref_kind='project'，随项目一起消失；
           而资源之间的引用（素材↔参考片）不动 —— 那是三库自己的关系，
           与项目删不删无关。被引用的素材本身也留在三库里，别的项目还能用。 */
        jdbc.update("DELETE FROM resource_refs WHERE ref_kind = 'project' AND ref_id = ?", projectId);

        return jdbc.update("DELETE FROM projects WHERE id = ?", projectId);
    }
}
