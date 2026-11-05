package com.fengmotion.server.project.store;

import java.util.List;

/**
 * 物理删除项目时需要的数据访问能力。
 *
 * <p><strong>为什么单列一个接口</strong>：归档只改 {@code projects} 一行，
 * 物理删除要连带清掉会话、消息、任务、事件、场景、场景版本与资源引用。
 * 这些表散在项目域之外（会话属聊天域、任务属任务域），放进
 * {@link ProjectDataRepository} 会让那个接口变成什么都能干的大杂烩。</p>
 *
 * <p><strong>删除顺序由实现保证</strong>：先子表后父表
 * （消息→会话、事件→任务、版本→场景→项目）。SQLite 默认不强制外键，
 * 顺序错了不会报错，只会留下指向不存在项目的孤儿行。</p>
 */
public interface ProjectPurgeRepository {

    /**
     * 统计该项目下仍在跑的任务。
     *
     * <p>「仍在跑」= 排队中、执行中、构建中。已结束（含失败）的任务不阻止删除 ——
     * 它们只是历史记录，跟着一块删掉即可。</p>
     *
     * @param projectId 项目 ID
     * @return 未结束的任务条数
     */
    int countRunningTasks(String projectId);

    /**
     * 删除项目及其从属数据。
     *
     * <p>只删属于该项目的行；三库资源（素材、技法、参考片）不动 ——
     * 项目只是引用它们，删项目不该把共用素材一起带走。</p>
     *
     * @param projectId 项目 ID
     * @return 删除的项目行数；0 表示项目不存在
     */
    int deleteProjectGraph(String projectId);

    /**
     * 读项目目录路径（含已归档的项目）。
     *
     * @param projectId 项目 ID
     * @return 目录绝对路径；项目不存在时为空
     */
    java.util.Optional<String> findRootPath(String projectId);

    /**
     * 未结束任务的简要描述，用于报给用户的冲突说明。
     *
     * @param projectId 项目 ID
     * @return 最多若干条任务标识
     */
    List<String> findRunningTaskLabels(String projectId);
}
