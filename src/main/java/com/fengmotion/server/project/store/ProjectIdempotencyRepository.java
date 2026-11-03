package com.fengmotion.server.project.store;

import java.time.Instant;
import java.util.Optional;

/** 项目创建幂等记录的存储接口。 */
public interface ProjectIdempotencyRepository {
    /** 在当前事务中取得写入资格，协调并发的检查与创建。 */
    void acquireWriteLock();

    Optional<IdempotencyRecord> findByKey(String key);

    void delete(String key);

    void save(String key, String requestHash, String projectId, Instant createdAt);

    record IdempotencyRecord(String requestHash, String projectId, Instant createdAt) {}
}
