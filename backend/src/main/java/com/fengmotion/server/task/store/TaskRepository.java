package com.fengmotion.server.task.store;

import java.util.List;
import java.util.Optional;

import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.domain.TaskEvent;

/**
 * 任务与任务事件的持久化。
 *
 * <p>状态迁移与事件写入必须成对：每次状态变化都要留下一条事件，否则
 * 「事件是状态迁移的唯一可观察出口」这条约定就破了。仓储层不强制这一点，
 * 由服务层在同一事务内保证。</p>
 */
public interface TaskRepository {

    /**
     * 保存新任务。
     *
     * @param task 任务
     */
    void save(Task task);

    /** 与新任务同时记录执行进程；内存替身可忽略此字段。 */
    default void save(Task task, String executionOwner) {
        save(task);
    }

    /**
     * 按 ID 查询任务。
     *
     * @param id 任务 ID
     * @return 任务；不存在时为空
     */
    Optional<Task> findById(String id);

    /**
     * 列出项目的任务。
     *
     * @param projectId 项目 ID
     * @param limit     上限
     * @return 任务列表，最新在前
     */
    List<Task> listByProject(String projectId, int limit);

    /**
     * 更新任务进度与状态。
     *
     * @param id           任务 ID
     * @param status       新状态
     * @param progress     进度 0~100
     * @param message      说明
     * @param artifactPath 产物路径；null 表示不改
     * @param errorCode    错误码；null 表示清除
     * @param finished     是否已结束（决定 finished_at）
     * @return 是否更新成功；false 表示任务已被取消或不存在
     */
    boolean updateProgress(String id, String status, int progress, String message,
                           String artifactPath, String errorCode, boolean finished);

    /**
     * 取消任务。
     *
     * @param id      任务 ID
     * @param message 取消说明
     * @return 是否成功取消；false 表示任务已结束
     */
    boolean cancel(String id, String message);

    /**
     * 记录任务与场景版本的关联。
     *
     * @param taskId        任务 ID
     * @param baseVersion   任务开始时的版本
     * @param resultVersion 本次提交的版本；未提交时为 null
     */
    void updateVersions(String taskId, Long baseVersion, Long resultVersion);

    /**
     * 追加一条事件，序号自动分配。
     *
     * @param event 事件（seq 字段被忽略，由实现分配）
     * @return 带真实序号的事件
     */
    TaskEvent appendEvent(TaskEvent event);

    /**
     * 读取指定序号之后的事件。
     *
     * @param taskId   任务 ID
     * @param afterSeq 只取该序号之后
     * @return 事件列表，按序号升序
     */
    List<TaskEvent> findEventsAfter(String taskId, long afterSeq);
}
