package com.fengmotion.server.project.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectIdempotencyRepository.IdempotencyRecord;

/**
 * 验证幂等记录的保存、查询、删除和写锁语句。
 *
 * <p>测试类上的 {@code @Transactional} 保证回滚，同时验证重复主键会被转换为
 * Spring 的 {@link DataAccessException}，而不是把 SQL 细节抛给调用方。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ProjectIdempotencyRepositoryTest {
    @Autowired
    private ProjectIdempotencyRepository idempotency;

    @Autowired
    private ProjectRepository projects;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private TransactionTemplate transactions;

    /** 保存后可按幂等键读回摘要、项目 ID 与创建时间。 */
    @Test
    void savesAndFindsRecord() {
        String key = UUID.randomUUID().toString();
        Instant createdAt = Instant.parse("2026-01-01T10:00:00Z");

        idempotency.save(key, "hash-" + key, "project-" + key, createdAt);

        IdempotencyRecord found = idempotency.findByKey(key).orElseThrow();
        assertEquals("hash-" + key, found.requestHash());
        assertEquals("project-" + key, found.projectId());
        assertEquals(createdAt, found.createdAt());
    }

    /** 不存在的键返回空结果。 */
    @Test
    void returnsEmptyForUnknownKey() {
        assertTrue(idempotency.findByKey(UUID.randomUUID().toString()).isEmpty());
    }

    /** 删除后不再能查到记录。 */
    @Test
    void deletesRecord() {
        String key = UUID.randomUUID().toString();
        idempotency.save(key, "hash", "project", Instant.parse("2026-01-01T10:00:00Z"));

        idempotency.delete(key);

        assertTrue(idempotency.findByKey(key).isEmpty());
    }

    /** 保存幂等记录时，项目关联字段按写入值原样保存。 */
    @Test
    void savesRecordNextToProjectInSameTransaction() {
        String projectId = UUID.randomUUID().toString();
        projects.save(new Project(projectId, "幂等项目", null, null, "/projects/idempotent", Instant.now()));
        String key = UUID.randomUUID().toString();

        idempotency.save(key, "hash", projectId, Instant.now());

        assertNotNull(projects.findById(projectId).orElse(null));
        assertEquals(projectId, idempotency.findByKey(key).orElseThrow().projectId());
    }

    /** 空更新在事务内执行且不修改任何项目行，也不会报错。 */
    @Test
    void acquireWriteLockDoesNotChangeProjects() {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "写锁项目", null, null, "/projects/lock", Instant.now()));

        Integer changed = transactions.execute(status -> {
            idempotency.acquireWriteLock();
            return jdbc.queryForObject("SELECT COUNT(*) FROM projects WHERE id = ?", Integer.class, id);
        });

        assertEquals(1, changed);
        assertEquals("写锁项目", projects.findById(id).orElseThrow().name());
    }

    /** 同一幂等键重复写入会触发主键约束，并被 MyBatis-Spring 转为 DataAccessException。 */
    @Test
    void duplicateKeyIsTranslatedToDataAccessException() {
        String key = UUID.randomUUID().toString();
        idempotency.save(key, "hash", "project", Instant.parse("2026-01-01T10:00:00Z"));

        assertThrows(DataAccessException.class,
                () -> idempotency.save(key, "other", "other-project", Instant.parse("2026-01-01T10:00:00Z")));
        assertEquals("hash", idempotency.findByKey(key).orElseThrow().requestHash());
    }

    /** 锁语句确实是 UPDATE，但不匹配任何行，也不改变已有项目的时间戳。 */
    @Test
    void acquireWriteLockMatchesNoRows() {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "锁语句项目", null, null, "/projects/lock-no-row", Instant.now()));
        String before = jdbc.queryForObject(
                "SELECT updated_at FROM projects WHERE id = ?", String.class, id);

        Integer changed = transactions.execute(status -> {
            idempotency.acquireWriteLock();
            return jdbc.queryForObject("SELECT changes()", Integer.class);
        });

        assertEquals(0, changed);
        assertEquals(before, jdbc.queryForObject(
                "SELECT updated_at FROM projects WHERE id = ?", String.class, id));
        assertNotNull(projects.findById(id).orElse(null));
    }
}
