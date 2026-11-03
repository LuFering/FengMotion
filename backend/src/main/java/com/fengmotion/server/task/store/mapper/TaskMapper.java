package com.fengmotion.server.task.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import com.fengmotion.server.task.store.mapper.TaskRow;

/**
 * tasks 与 task_events 两张表的映射。
 *
 * <p>事件表只追加：写入后不改，序号在任务内递增，唯一约束
 * {@code UNIQUE(task_id, seq)} 是并发下的最后一道保护。</p>
 */
@Mapper
public interface TaskMapper {

    /**
     * 插入任务。
     *
     * @param row 任务行
     * @return 实际写入行数
     */
    @Insert("""
            INSERT INTO tasks
                (id, project_id, kind, status, prompt, request_json, progress, message,
                 artifact_path, error_code, created_at, updated_at, finished_at)
            VALUES
                (#{id}, #{projectId}, #{kind}, #{status}, #{prompt}, #{requestJson}, #{progress},
                 #{message}, #{artifactPath}, #{errorCode}, #{createdAt}, #{updatedAt}, #{finishedAt})
            """)
    int insert(TaskRow row);

    /**
     * 按 ID 查询任务。
     *
     * @param id 任务 ID
     * @return 任务行；不存在时为 null
     */
    @Select("""
            SELECT id, project_id AS projectId, kind, status, prompt,
                   request_json AS requestJson, progress, message,
                   artifact_path AS artifactPath, error_code AS errorCode,
                   created_at AS createdAt, updated_at AS updatedAt, finished_at AS finishedAt
            FROM tasks
            WHERE id = #{id}
            """)
    TaskRow findById(@Param("id") String id);

    /**
     * 列出项目的任务，最新在前。
     *
     * @param projectId 项目 ID
     * @param limit     上限
     * @return 任务行列表
     */
    @Select("""
            SELECT id, project_id AS projectId, kind, status, prompt,
                   request_json AS requestJson, progress, message,
                   artifact_path AS artifactPath, error_code AS errorCode,
                   created_at AS createdAt, updated_at AS updatedAt, finished_at AS finishedAt
            FROM tasks
            WHERE project_id = #{projectId}
            ORDER BY created_at DESC
            LIMIT #{limit}
            """)
    List<TaskRow> listByProject(@Param("projectId") String projectId, @Param("limit") int limit);

    /**
     * 更新任务的状态与进度。
     *
     * <p>带 {@code status <> 'cancelled'} 条件：一旦被取消就不能再改回执行中 ——
     * 后台线程可能在取消之后才跑到状态更新那一步，没有这个条件会把
     * 「已取消」覆盖成「已完成」，用户会看到一个本该停掉的任务又活过来。</p>
     *
     * @param id           任务 ID
     * @param status       新状态
     * @param progress     进度
     * @param message      说明
     * @param artifactPath 产物路径；null 表示不改
     * @param errorCode    错误码；null 表示不改
     * @param updatedAt    更新时间
     * @param finishedAt   结束时间；null 表示未结束
     * @return 实际更新行数；0 表示任务已被取消或不存在
     */
    @Update("""
            UPDATE tasks
            SET status = #{status},
                progress = #{progress},
                message = #{message},
                artifact_path = COALESCE(#{artifactPath}, artifact_path),
                error_code = #{errorCode},
                updated_at = #{updatedAt},
                finished_at = #{finishedAt}
            WHERE id = #{id} AND status <> 'cancelled'
            """)
    int updateProgress(@Param("id") String id,
                       @Param("status") String status,
                       @Param("progress") int progress,
                       @Param("message") String message,
                       @Param("artifactPath") String artifactPath,
                       @Param("errorCode") String errorCode,
                       @Param("updatedAt") String updatedAt,
                       @Param("finishedAt") String finishedAt);

    /**
     * 取消任务（只对未结束的任务生效）。
     *
     * @param id        任务 ID
     * @param updatedAt 更新时间
     * @param message   取消说明
     * @return 实际更新行数；0 表示任务已结束或不存在
     */
    @Update("""
            UPDATE tasks
            SET status = 'cancelled', message = #{message},
                updated_at = #{updatedAt}, finished_at = #{updatedAt}
            WHERE id = #{id} AND status IN ('queued', 'running', 'building')
            """)
    int markCancelled(@Param("id") String id,
                      @Param("updatedAt") String updatedAt,
                      @Param("message") String message);

    /**
     * 查询任务当前的最大事件序号。
     *
     * @param taskId 任务 ID
     * @return 最大序号；没有事件时为 null
     */
    @Select("SELECT MAX(seq) FROM task_events WHERE task_id = #{taskId}")
    Long findMaxEventSeq(@Param("taskId") String taskId);

    /**
     * 追加一条任务事件。
     *
     * @param row 事件行
     * @return 实际写入行数
     */
    @Insert("""
            INSERT INTO task_events
                (id, task_id, seq, kind, status, message, data_json, at)
            VALUES
                (#{id}, #{taskId}, #{seq}, #{kind}, #{status}, #{message}, #{dataJson}, #{at})
            """)
    int insertEvent(TaskEventRow row);

    /**
     * 按序号读取任务事件（用于断线重连补发）。
     *
     * @param taskId   任务 ID
     * @param afterSeq 只取该序号之后的事件
     * @return 事件行列表，按序号升序
     */
    @Select("""
            SELECT id, task_id AS taskId, seq, kind, status, message,
                   data_json AS dataJson, at
            FROM task_events
            WHERE task_id = #{taskId} AND seq > #{afterSeq}
            ORDER BY seq ASC
            """)
    List<TaskEventRow> findEventsAfter(@Param("taskId") String taskId, @Param("afterSeq") long afterSeq);

    /**
     * 空更新：在事务内提前请求 SQLite 写锁。
     *
     * <p>事件序号是「读 MAX(seq) 再写 MAX+1」的读-改-写，必须与读取同处一把写锁下，
     * 否则两个并发写入会拿到同一个 seq（唯一约束会报错，但报错比排队更糟）。</p>
     *
     * @param taskId 任务 ID
     * @return 更新行数（恒为 1，任务存在时）
     */
    @Update("UPDATE tasks SET updated_at = updated_at WHERE id = #{taskId}")
    int acquireWriteLock(@Param("taskId") String taskId);
}
