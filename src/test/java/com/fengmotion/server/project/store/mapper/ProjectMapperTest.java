package com.fengmotion.server.project.store.mapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

/**
 * 直接验证 Mapper 的行映射与固定 SQL。
 *
 * <p>重点覆盖仓储与 API 测试不容易观察到的细节：列别名映射、SQL NULL 的目标时长、
 * 三个固定排序方法以及幂等记录的增删查。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ProjectMapperTest {
    private static final String CREATED_AT = "2026-01-01T00:00:00Z";

    @Autowired
    private ProjectMapper projectMapper;

    @Autowired
    private ProjectDataMapper dataMapper;

    @Autowired
    private ProjectIdempotencyMapper idempotencyMapper;

    private void insert(String id, String name, String tagline, String stage, Long duration, String updatedAt) {
        ProjectRow row = new ProjectRow();
        row.setId(id);
        row.setName(name);
        row.setGenomeId("genome-" + id);
        row.setTargetDurationMs(duration);
        row.setRootPath("/projects/" + id);
        row.setCreatedAt(CREATED_AT);
        row.setUpdatedAt(updatedAt);
        row.setEtag(id + "-etag");
        projectMapper.insert(row);

        // projects 插入语句不写 tagline/stage（与项目创建语义一致），这里再用条件更新补齐。
        dataMapper.updateIfMatch(new ProjectDataMapper.ProjectUpdateParams(
                id, id + "-etag", name, tagline, stage, "genome-" + id, duration, updatedAt, id + "-etag"));
    }

    /** 显式列别名把下划线列映射到驼峰字段，并区分 null 与 0。 */
    @Test
    void mapsColumnsToRowFields() {
        String id = UUID.randomUUID().toString();
        insert(id, "映射项目", "简介", "draft", null, "2026-01-02T00:00:00Z");

        // ProjectMapper.findById 保留原有投影：只读取 Project 需要的六列。
        ProjectRow row = projectMapper.findById(id);

        assertNotNull(row);
        assertEquals(id, row.getId());
        assertEquals("映射项目", row.getName());
        assertEquals("genome-" + id, row.getGenomeId());
        assertNull(row.getTargetDurationMs());
        assertEquals("/projects/" + id, row.getRootPath());
        assertEquals(CREATED_AT, row.getCreatedAt());

        // 活动项目查询读取完整字段，别名映射同样生效。
        ProjectRow active = dataMapper.findActiveById(id);
        assertEquals("简介", active.getTagline());
        assertEquals("draft", active.getStage());
        assertEquals("2026-01-02T00:00:00Z", active.getUpdatedAt());
        assertEquals(id + "-etag", active.getEtag());
        assertNull(active.getTargetDurationMs());
    }

    /** 真实的 0 不会被当作 SQL NULL。 */
    @Test
    void keepsZeroTargetDuration() {
        String id = UUID.randomUUID().toString();
        insert(id, "零时长", "", "idea", 0L, CREATED_AT);

        assertEquals(0L, dataMapper.findActiveById(id).getTargetDurationMs());
    }

    /** 不存在时 Mapper 返回 null，由仓储包装成空的 Optional。 */
    @Test
    void returnsNullForUnknownId() {
        assertNull(projectMapper.findById(UUID.randomUUID().toString()));
        assertNull(dataMapper.findActiveById(UUID.randomUUID().toString()));
        assertNull(idempotencyMapper.findByKey(UUID.randomUUID().toString()));
    }

    /** 条件更新返回受影响行数，并在匹配时更新目标字段。 */
    @Test
    void updateIfMatchReturnsAffectedRows() {
        String id = UUID.randomUUID().toString();
        insert(id, "更新前", "", "idea", 1000L, CREATED_AT);

        int changed = dataMapper.updateIfMatch(new ProjectDataMapper.ProjectUpdateParams(
                id, id + "-etag", "更新后", "新简介", "done", "g2", null,
                "2026-03-03T00:00:00Z", "etag-next"));
        int stale = dataMapper.updateIfMatch(new ProjectDataMapper.ProjectUpdateParams(
                id, id + "-etag", "过期写入", "", "idea", null, null, CREATED_AT, "etag-stale"));

        assertEquals(1, changed);
        assertEquals(0, stale);
        ProjectRow row = dataMapper.findActiveById(id);
        assertEquals("更新后", row.getName());
        assertEquals("新简介", row.getTagline());
        assertEquals("done", row.getStage());
        assertNull(row.getTargetDurationMs());
        assertEquals("etag-next", row.getEtag());
    }

    /** 三个固定排序方法都按名称或更新时间返回预期顺序。 */
    @Test
    void fixedSortMethodsReturnExpectedOrder() {
        String marker = "mapper-sort-" + UUID.randomUUID();
        String a = UUID.randomUUID().toString();
        String b = UUID.randomUUID().toString();
        insert(a, "b-" + marker, marker, "idea", null, "2026-01-01T01:00:00Z");
        insert(b, "a-" + marker, marker, "idea", null, "2026-01-01T02:00:00Z");

        assertEquals(List.of(b, a), ids(dataMapper.findActiveByUpdatedDesc(null, marker, 10, 0)));
        assertEquals(List.of(a, b), ids(dataMapper.findActiveByUpdatedAsc(null, marker, 10, 0)));
        assertEquals(List.of(b, a), ids(dataMapper.findActiveByNameAsc(null, marker, 10, 0)));
    }

    /** 幂等 Mapper 的保存、查询与删除。 */
    @Test
    void idempotencyInsertFindDelete() {
        String key = UUID.randomUUID().toString();

        assertEquals(1, idempotencyMapper.insert(key, "hash", "project", CREATED_AT));
        IdempotencyRow row = idempotencyMapper.findByKey(key);
        assertEquals("hash", row.getRequestHash());
        assertEquals("project", row.getProjectId());
        assertEquals(CREATED_AT, row.getCreatedAt());

        assertEquals(1, idempotencyMapper.deleteByKey(key));
        assertNull(idempotencyMapper.findByKey(key));
    }

    private static List<String> ids(List<ProjectRow> rows) {
        return rows.stream().map(ProjectRow::getId).toList();
    }
}
