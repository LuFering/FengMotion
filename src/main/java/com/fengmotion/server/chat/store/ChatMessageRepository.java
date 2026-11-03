package com.fengmotion.server.chat.store;

import java.util.List;
import java.util.Optional;

import com.fengmotion.server.chat.domain.ChatMessage;

/**
 * 会话消息的数据访问接口。
 *
 * <p>接口只提供追加和读取：消息表不原地修改。序号（{@code seq}）的分配在实现里完成，
 * 调用方只描述「往哪个会话追加一条什么消息」。</p>
 */
public interface ChatMessageRepository {
    /**
     * 在当前事务中提前取得 SQLite 写锁，供随后的「读最大序号 + 插入」使用。
     */
    void acquireWriteLock();

    /**
     * 追加一条消息，序号由存储层分配为「当前最大序号 + 1」。
     *
     * <p>必须在事务内调用；同一会话的并发追加由写锁与唯一约束共同兜底。</p>
     *
     * @param message 要追加的消息；{@code seq} 由实现覆盖
     * @return 实际写入的消息（含分配的序号）
     */
    ChatMessage append(ChatMessage message);

    /**
     * 按 ID 查询消息。
     *
     * @param id 消息 ID
     * @return 找到时包含消息，否则为空
     */
    Optional<ChatMessage> findById(String id);

    /**
     * 查询会话消息数。
     *
     * @param sessionId 会话 ID
     * @return 消息数量
     */
    int countBySessionId(String sessionId);

    /**
     * 按序号正序查询一页消息。
     *
     * @param sessionId 会话 ID
     * @param afterSeq  已读到的最大序号；从开头读取时传 0
     * @param limit     最多返回的记录数
     * @return 序号更大的消息
     */
    List<ChatMessage> findAfterSeq(String sessionId, long afterSeq, int limit);
}
