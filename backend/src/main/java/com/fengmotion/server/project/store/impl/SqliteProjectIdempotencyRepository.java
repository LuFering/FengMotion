package com.fengmotion.server.project.store.impl;

import com.fengmotion.server.project.store.ProjectIdempotencyRepository;
import com.fengmotion.server.project.store.mapper.ProjectIdempotencyMapper;

import java.time.Instant;
import java.util.Optional;

import org.springframework.stereotype.Repository;

import lombok.RequiredArgsConstructor;

/**
 * 使用 SQLite 保存项目创建的幂等记录；SQL 由 {@link ProjectIdempotencyMapper} 承载。
 *
 * <p>本类不声明事务边界。写锁语句与幂等记录读写的执行时机由调用方
 * {@code ProjectCreationCoordinator} 的 {@code TransactionTemplate} 决定。</p>
 */
@Repository
@RequiredArgsConstructor
public class SqliteProjectIdempotencyRepository implements ProjectIdempotencyRepository {
    private final ProjectIdempotencyMapper mapper;

    @Override
    public void acquireWriteLock() {
        // 空更新不修改项目行；在调用方事务内提前请求 SQLite 写锁。
        mapper.acquireWriteLock();
    }

    @Override
    public Optional<IdempotencyRecord> findByKey(String key) {
        return Optional.ofNullable(mapper.findByKey(key)).map(row -> new IdempotencyRecord(
                row.getRequestHash(), row.getProjectId(), Instant.parse(row.getCreatedAt())));
    }

    @Override
    public void delete(String key) {
        mapper.deleteByKey(key);
    }

    @Override
    public void save(String key, String requestHash, String projectId, Instant createdAt) {
        mapper.insert(key, requestHash, projectId, createdAt.toString());
    }
}
