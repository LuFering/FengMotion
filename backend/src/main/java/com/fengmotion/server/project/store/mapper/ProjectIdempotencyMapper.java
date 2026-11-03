package com.fengmotion.server.project.store.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * project_idempotency 表的读写，以及创建项目时使用的 SQLite 写锁语句。
 *
 * <p>Mapper 只承载 SQL，不声明事务边界；{@link #acquireWriteLock()} 必须由调用方
 * 在 {@code TransactionTemplate} 已经开启的事务中执行，才能起到提前请求 SQLite
 * 写锁的作用。</p>
 */
@Mapper
public interface ProjectIdempotencyMapper {

    /**
     * 空更新：不会匹配任何项目行，但在事务内执行时会请求 SQLite 写锁。
     *
     * @return 受影响行数，固定为 0
     */
    @Update("UPDATE projects SET id = id WHERE 0")
    int acquireWriteLock();

    /**
     * 按幂等键查询记录。
     *
     * @param key 幂等键
     * @return 记录；不存在时为 null
     */
    @Select("""
            SELECT request_hash AS requestHash, project_id AS projectId, created_at AS createdAt
            FROM project_idempotency
            WHERE key = #{key}
            """)
    IdempotencyRow findByKey(@Param("key") String key);

    /**
     * 删除幂等键对应的记录。
     *
     * @param key 幂等键
     * @return 受影响行数
     */
    @Delete("DELETE FROM project_idempotency WHERE key = #{key}")
    int deleteByKey(@Param("key") String key);

    /**
     * 保存幂等记录。
     *
     * @param key 幂等键
     * @param requestHash 请求摘要
     * @param projectId 关联的项目 ID
     * @param createdAt ISO-8601 格式的创建时间
     * @return 受影响行数
     */
    @Insert("""
            INSERT INTO project_idempotency (key, request_hash, project_id, created_at)
            VALUES (#{key}, #{requestHash}, #{projectId}, #{createdAt})
            """)
    int insert(@Param("key") String key, @Param("requestHash") String requestHash,
            @Param("projectId") String projectId, @Param("createdAt") String createdAt);
}
