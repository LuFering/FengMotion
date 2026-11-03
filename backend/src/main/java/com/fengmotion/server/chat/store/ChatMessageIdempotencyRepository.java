package com.fengmotion.server.chat.store;

import java.time.Instant;
import java.util.Optional;

/**
 * 发消息幂等记录的存储接口。
 *
 * <p>消息只追加，所以一次重试只能返回原来那条消息，不能重新生成一条。
 * 记录的有效期、键与请求内容是否一致由服务层判断。</p>
 */
public interface ChatMessageIdempotencyRepository {
    /**
     * 按幂等键查询记录。
     *
     * @param key 幂等键
     * @return 找到时包含记录，否则为空
     */
    Optional<Record> findByKey(String key);

    /**
     * 保存记录。
     *
     * @param key         幂等键
     * @param requestHash 请求摘要
     * @param sessionId   发送到的会话
     * @param messageId   已写入的消息 ID
     * @param createdAt   创建时间
     */
    void save(String key, String requestHash, String sessionId, String messageId, Instant createdAt);

    /**
     * 删除过期记录，允许幂等键被重新使用。
     *
     * @param key 幂等键
     */
    void delete(String key);

    /**
     * 一条幂等记录。
     *
     * @param requestHash 请求摘要
     * @param sessionId   发送到的会话
     * @param messageId   已写入的消息 ID
     * @param createdAt   创建时间
     */
    record Record(String requestHash, String sessionId, String messageId, Instant createdAt) {
    }
}
