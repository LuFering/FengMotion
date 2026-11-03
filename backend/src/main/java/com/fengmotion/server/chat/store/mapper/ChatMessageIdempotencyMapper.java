package com.fengmotion.server.chat.store.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * chat_message_idempotency 表的读写。
 *
 * <p>发消息重试的语义与项目创建一致：同一个键 + 同一份请求内容返回原来那条消息；
 * 同一个键换了请求内容返回 409。消息只追加，所以幂等记录一旦写入就指向一条不可变的消息。</p>
 */
@Mapper
public interface ChatMessageIdempotencyMapper {

    /**
     * 按幂等键查询记录。
     *
     * @param key 幂等键
     * @return 记录；不存在时为 null
     */
    @Select("""
            SELECT request_hash AS requestHash, session_id AS sessionId,
                   message_id AS messageId, created_at AS createdAt
            FROM chat_message_idempotency
            WHERE key = #{key}
            """)
    ChatMessageIdempotencyRow findByKey(@Param("key") String key);

    /**
     * 保存幂等记录。
     *
     * @param key         幂等键
     * @param requestHash 请求摘要
     * @param sessionId   发送到哪个会话
     * @param messageId   已写入的消息 ID
     * @param createdAt   ISO-8601 格式的创建时间
     * @return 受影响行数
     */
    @Insert("""
            INSERT INTO chat_message_idempotency (key, request_hash, session_id, message_id, created_at)
            VALUES (#{key}, #{requestHash}, #{sessionId}, #{messageId}, #{createdAt})
            """)
    int insert(@Param("key") String key, @Param("requestHash") String requestHash,
            @Param("sessionId") String sessionId, @Param("messageId") String messageId,
            @Param("createdAt") String createdAt);

    /**
     * 删除幂等键对应的记录。
     *
     * @param key 幂等键
     * @return 受影响行数
     */
    @Delete("DELETE FROM chat_message_idempotency WHERE key = #{key}")
    int deleteByKey(@Param("key") String key);
}
