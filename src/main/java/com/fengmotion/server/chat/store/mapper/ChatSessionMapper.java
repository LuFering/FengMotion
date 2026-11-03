package com.fengmotion.server.chat.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * chat_sessions 表的 MyBatis 映射，是会话模块唯一的持久化实现入口。
 *
 * <p>这里使用普通 MyBatis 注解 Mapper，而不是 MyBatis-Plus 的 {@code BaseMapper}：
 * 会话模块只需要几条固定 SQL，列表查询又要求明确的
 * {@code ORDER BY ... LIMIT ... OFFSET ...}（MyBatis-Plus 只能用 {@code last()}
 * 拼接分页片段），显式注解 SQL 更直接，也避免为同一张表再维护一套实体与 TableInfo。
 * MyBatis-Spring 仍会把这里抛出的异常翻译为 Spring 的 {@code DataAccessException}。</p>
 *
 * <p>排序以 {@code julianday(updated_at)} 为主键，而不是直接比较 TEXT：SQLite 中
 * {@code Instant.toString()} 的毫秒位数不固定（例如 {@code 10:00:00Z} 与
 * {@code 10:00:00.500Z}），按字符串倒序会把同一秒内的记录排错。
 * {@code julianday} 精确到毫秒；同一毫秒内的记录按契约用 id 升序作为稳定次序。</p>
 *
 * <p>软删除：{@code deleted_at} 非空即视为已删除。所有对外查询都带
 * {@code deleted_at IS NULL}，消息与审计数据保留在原表中。</p>
 */
@Mapper
public interface ChatSessionMapper {

    /**
     * 插入一条会话记录。
     *
     * @param row 已转换为数据库文本格式的会话行
     * @return 实际写入的行数
     */
    @Insert("""
            INSERT INTO chat_sessions
                (id, project_id, title, created_at, updated_at)
            VALUES
                (#{id}, #{projectId}, #{title}, #{createdAt}, #{updatedAt})
            """)
    int insert(ChatSessionRow row);

    /**
     * 根据会话 ID 查询一行未删除的会话。
     *
     * <p>{@code messageCount} 用相关子查询实时派生，避免在会话表里维护一份计数。
     * 会话 ID 是主键，子查询只走消息表的 {@code (session_id, seq)} 索引。</p>
     *
     * @param id 会话 ID
     * @return 查询结果；不存在或已删除时为 null
     */
    @Select("""
            SELECT s.id         AS id,
                   s.project_id AS projectId,
                   s.title      AS title,
                   s.created_at AS createdAt,
                   s.updated_at AS updatedAt,
                   (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id AND m.role <> 'system') AS messageCount,
                   s.harness_session_id AS harnessSessionId
            FROM chat_sessions s
            WHERE s.id = #{id} AND s.deleted_at IS NULL
            """)
    ChatSessionRow findById(@Param("id") String id);

    /**
     * 查询指定项目下未删除的会话，按最近更新倒序，更新时间相同时按 ID 升序稳定排序。
     *
     * @param projectId 项目 ID
     * @param limit     最多返回的记录数
     * @param offset    跳过的记录数
     * @return 该项目的会话行
     */
    @Select("""
            SELECT s.id         AS id,
                   s.project_id AS projectId,
                   s.title      AS title,
                   s.created_at AS createdAt,
                   s.updated_at AS updatedAt,
                   (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id AND m.role <> 'system') AS messageCount,
                   s.harness_session_id AS harnessSessionId
            FROM chat_sessions s
            WHERE s.project_id = #{projectId} AND s.deleted_at IS NULL
            ORDER BY julianday(s.updated_at) DESC, s.id ASC
            LIMIT #{limit} OFFSET #{offset}
            """)
    List<ChatSessionRow> findByProjectId(
            @Param("projectId") String projectId,
            @Param("limit") int limit,
            @Param("offset") int offset);

    /**
     * 软删除会话：写入删除时间；重复删除不改变已有删除时间。
     *
     * <p>删除会话不取消其任务（agent.md §5），因此这里只动会话行，消息原样保留。</p>
     *
     * @param id        会话 ID
     * @param deletedAt ISO-8601 格式的删除时间
     * @return 受影响行数；0 表示会话不存在或已删除
     */
    @Update("""
            UPDATE chat_sessions
            SET deleted_at = #{deletedAt}
            WHERE id = #{id} AND deleted_at IS NULL
            """)
    int softDelete(@Param("id") String id, @Param("deletedAt") String deletedAt);

    /**
     * 新消息写入后刷新会话的更新时间，使会话列表按最近活动排序。
     *
     * @param id        会话 ID
     * @param updatedAt ISO-8601 格式的更新时间
     * @return 受影响行数
     */
    @Update("""
            UPDATE chat_sessions
            SET updated_at = #{updatedAt}
            WHERE id = #{id} AND deleted_at IS NULL
            """)
    int touch(@Param("id") String id, @Param("updatedAt") String updatedAt);

    /**
     * 绑定该会话对应的 DSH 会话标识。
     *
     * <p>只在首次调用引擎时写入一次；同一个 DSH 会话标识会被后续轮次复用，
     * 这样多轮对话能续接上下文。重复写入同一个值不改变结果。</p>
     *
     * @param id               会话 ID
     * @param harnessSessionId DSH 会话标识
     * @return 受影响行数
     */
    @Update("""
            UPDATE chat_sessions
            SET harness_session_id = #{harnessSessionId}
            WHERE id = #{id} AND deleted_at IS NULL
            """)
    int bindHarnessSession(
            @Param("id") String id,
            @Param("harnessSessionId") String harnessSessionId);

    /**
     * 更新会话标题。
     *
     * <p>刻意不刷新 {@code updated_at}：标题是引擎在回复过程中顺带给出的元信息，
     * 不是用户的动作。刷新时间会让左栏的「N分钟前」在回复结束时突然归零，
     * 让用户以为刚动过这个会话。</p>
     *
     * @param id    会话 ID
     * @param title 新标题
     * @return 实际更新的行数
     */
    @Update("""
            UPDATE chat_sessions
            SET title = #{title}
            WHERE id = #{id} AND deleted_at IS NULL
            """)
    int updateTitle(@Param("id") String id, @Param("title") String title);
}
