package com.fengmotion.server.chat.store;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import com.fengmotion.server.chat.domain.ChatSession;

/**
 * 对话会话的数据访问接口。
 */
public interface ChatSessionRepository {
    /**
     * 保存新会话。
     *
     * @param session 要保存的会话
     */
    void save(ChatSession session);

    /**
     * 根据会话 ID 查找未删除的会话。
     *
     * @param id 会话 ID
     * @return 找到时包含会话，未找到或已删除时为空
     */
    Optional<ChatSession> findById(String id);

    /**
     * 查询指定项目下未删除的会话。
     *
     * @param projectId 项目 ID
     * @param limit     最多返回的记录数
     * @param offset    跳过的记录数
     * @return 该项目的会话列表
     */
    List<ChatSession> findByProjectId(String projectId, int limit, int offset);

    /**
     * 软删除会话；消息保留用于审计。
     *
     * @param id        会话 ID
     * @param deletedAt 删除时间
     * @return 实际更新的行数；0 表示会话不存在或已删除
     */
    int softDelete(String id, Instant deletedAt);

    /**
     * 刷新会话的最后更新时间。
     *
     * @param id        会话 ID
     * @param updatedAt 新的更新时间
     * @return 实际更新的行数
     */
    int touch(String id, Instant updatedAt);

    /**
     * 绑定会话对应的 DSH 会话标识。
     *
     * <p>首次调用引擎时写入，后续轮次复用同一个标识以续接上下文。</p>
     *
     * @param id               会话 ID
     * @param harnessSessionId DSH 会话标识
     * @return 实际更新的行数
     */
    int bindHarnessSession(String id, String harnessSessionId);

    /**
     * 更新会话标题（由引擎回传的 {@code session/title} 触发）。
     *
     * <p>只改标题、不刷新 {@code updated_at}：标题是引擎在回复过程中给出的元信息，
     * 不是用户的动作，不该让左栏时间戳跳动。</p>
     *
     * @param id    会话 ID
     * @param title 新标题
     * @return 实际更新的行数
     */
    int updateTitle(String id, String title);
}
