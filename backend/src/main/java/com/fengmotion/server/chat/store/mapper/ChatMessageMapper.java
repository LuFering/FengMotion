package com.fengmotion.server.chat.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * chat_messages 表的 MyBatis 映射。
 *
 * <p>消息表只追加：本接口提供插入和按序号读取，没有 UPDATE 正文的语句。
 * {@code seq} 由调用方在同一事务内取「当前最大值 + 1」，唯一约束
 * {@code UNIQUE(session_id, seq)} 是并发下的最后一道保护。</p>
 *
 * <p>翻页用 {@code seq > #{afterSeq}} 而不是 OFFSET：消息持续追加时偏移量会随新消息
 * 漂移（读到重复或漏读），按序号做键集分页则稳定。历史上的游标由服务层解释为序号。</p>
 */
@Mapper
public interface ChatMessageMapper {

    /**
     * 空更新：不会匹配任何会话行，但在事务内执行时会请求 SQLite 写锁。
     *
     * <p>序号分配是「先读 MAX(seq) 再写入 MAX+1」的读-改-写，必须在同一把数据库写锁下
     * 完成。先发出这条写语句，让同一时刻的其他写入者等待，再读取最大序号，
     * 两个并发追加才不会拿到同一个 seq。</p>
     *
     * <p>必须由调用方在已开启的事务中执行；Mapper 本身不声明事务边界。</p>
     *
     * @return 受影响行数，固定为 0
     */
    @Update("UPDATE chat_sessions SET id = id WHERE 0")
    int acquireWriteLock();

    /**
     * 插入一条消息。
     *
     * @param row 已转换为数据库文本格式的消息行
     * @return 实际写入的行数
     */
    @Insert("""
            INSERT INTO chat_messages
                (id, session_id, seq, role, text, task_id, references_json, attachments_json,
                 tool_calls_json, created_at)
            VALUES
                (#{id}, #{sessionId}, #{seq}, #{role}, #{text}, #{taskId},
                 #{referencesJson}, #{attachmentsJson}, #{toolCallsJson}, #{createdAt})
            """)
    int insert(ChatMessageRow row);

    /**
     * 按 ID 查询一条消息。
     *
     * @param id 消息 ID
     * @return 消息行；不存在时为 null
     */
    @Select("""
            SELECT id             AS id,
                   session_id     AS sessionId,
                   seq            AS seq,
                   role           AS role,
                   text           AS text,
                   task_id        AS taskId,
                   references_json  AS referencesJson,
                   attachments_json AS attachmentsJson,
                   tool_calls_json  AS toolCallsJson,
                   created_at     AS createdAt
            FROM chat_messages
            WHERE id = #{id}
            """)
    ChatMessageRow findById(@Param("id") String id);

    /**
     * 查询会话的最大序号。
     *
     * @param sessionId 会话 ID
     * @return 最大序号；会话还没有消息时为 null
     */
    @Select("SELECT MAX(seq) FROM chat_messages WHERE session_id = #{sessionId}")
    Long findMaxSeq(@Param("sessionId") String sessionId);

    /**
     * 查询会话中的消息数；{@code system} 消息只供内部使用，不计入对外的消息数。
     *
     * @param sessionId 会话 ID
     * @return 消息数量；没有消息时为 0
     */
    @Select("SELECT COUNT(*) FROM chat_messages WHERE session_id = #{sessionId} AND role <> 'system'")
    int countBySessionId(@Param("sessionId") String sessionId);

    /**
     * 按序号正序查询一页消息，只返回序号大于 {@code afterSeq} 的记录。
     *
     * <p>{@code system} 角色不下发展示（agent.md §3），因此这里直接过滤掉；
     * 它们仍占用序号，客户端看到的序号可能不连续，但顺序与游标依旧正确。</p>
     *
     * @param sessionId 会话 ID
     * @param afterSeq  已读到的最大序号；从开头读取时传 0
     * @param limit     最多返回的记录数
     * @return 该会话的消息行
     */
    @Select("""
            SELECT id             AS id,
                   session_id     AS sessionId,
                   seq            AS seq,
                   role           AS role,
                   text           AS text,
                   task_id        AS taskId,
                   references_json  AS referencesJson,
                   attachments_json AS attachmentsJson,
                   tool_calls_json  AS toolCallsJson,
                   created_at     AS createdAt
            FROM chat_messages
            WHERE session_id = #{sessionId} AND seq > #{afterSeq} AND role <> 'system'
            ORDER BY seq ASC
            LIMIT #{limit}
            """)
    List<ChatMessageRow> findAfterSeq(
            @Param("sessionId") String sessionId,
            @Param("afterSeq") long afterSeq,
            @Param("limit") int limit);
}
