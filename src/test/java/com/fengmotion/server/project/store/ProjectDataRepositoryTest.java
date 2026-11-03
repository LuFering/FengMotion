package com.fengmotion.server.project.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectDataRepository.ProjectChanges;
import com.fengmotion.server.project.store.ProjectDataRepository.ProjectData;
import com.fengmotion.server.project.store.ProjectDataRepository.Sort;

/**
 * 验证项目查询与条件更新的仓储行为。
 *
 * <p>每个测试使用唯一的搜索标记，避免共享测试库中其他记录影响排序和筛选结果。
 * {@link JdbcTemplate} 只用于构造 archived 这种目前没有仓储写入口的场景，不参与被测逻辑。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ProjectDataRepositoryTest {
    private static final Instant CREATED_AT = Instant.parse("2026-01-01T00:00:00Z");

    @Autowired
    private ProjectRepository projects;

    @Autowired
    private ProjectDataRepository data;

    @Autowired
    private JdbcTemplate jdbc;

    /** 保存项目，再用条件更新补齐简介、阶段与更新时间，返回最终 etag。 */
    private String saveProject(String id, String name, String tagline, String stage, Long duration,
            Instant updatedAt) {
        projects.save(new Project(id, name, null, duration, "/projects/" + id, CREATED_AT));
        int changed = data.updateIfMatch(id, id,
                new ProjectChanges(name, tagline, stage, null, duration), updatedAt, id + "-etag");
        assertEquals(1, changed);
        return id + "-etag";
    }

    /** 目标时长为 SQL NULL 时，查询结果保持 null 而不是 0。 */
    @Test
    void keepsNullTargetDurationInProjectData() {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "空时长项目", null, null, "/projects/null-duration", CREATED_AT));

        ProjectData found = data.findActiveById(id).orElseThrow();

        assertNull(found.targetDurationMs());
        assertEquals("空时长项目", found.name());
    }

    /** findActiveById 只返回未归档项目；ProjectRepository.findById 不过滤 archived。 */
    @Test
    void findActiveByIdExcludesArchivedWhileRepositoryFindByIdKeepsIt() {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "归档项目", null, null, "/projects/archived", CREATED_AT));
        jdbc.update("UPDATE projects SET archived = 1 WHERE id = ?", id);

        assertTrue(data.findActiveById(id).isEmpty());
        assertEquals("归档项目", projects.findById(id).orElseThrow().name());
    }

    /** 三种排序都由固定 SQL 决定，名称与更新时间顺序不同可以区分排序字段。 */
    @Test
    void findActiveUsesEachFixedSort() {
        String marker = "sort-" + UUID.randomUUID();
        String first = UUID.randomUUID().toString();
        String second = UUID.randomUUID().toString();
        String third = UUID.randomUUID().toString();
        saveProject(first, "bravo-" + marker, marker, "idea", 1000L, Instant.parse("2026-01-01T01:00:00Z"));
        saveProject(second, "alpha-" + marker, marker, "idea", 2000L, Instant.parse("2026-01-01T02:00:00Z"));
        saveProject(third, "charlie-" + marker, marker, "idea", 3000L, Instant.parse("2026-01-01T03:00:00Z"));

        assertEquals(List.of(third, second, first), ids(data.findActive(null, marker, Sort.UPDATED_DESC, 10, 0)));
        assertEquals(List.of(first, second, third), ids(data.findActive(null, marker, Sort.UPDATED_ASC, 10, 0)));
        assertEquals(List.of(second, first, third), ids(data.findActive(null, marker, Sort.NAME_ASC, 10, 0)));
    }

    /** 同一秒内的亚秒更新时间必须按真实时间排序，而不是按 ISO 文本比较。 */
    @Test
    void findActiveOrdersByActualTimestampWithinSameSecond() {
        String marker = "subsecond-" + UUID.randomUUID();
        String wholeSecond = UUID.randomUUID().toString();
        String halfSecond = UUID.randomUUID().toString();
        saveProject(halfSecond, "b-" + marker, marker, "idea", null, Instant.parse("2026-01-01T10:00:00.500Z"));
        saveProject(wholeSecond, "a-" + marker, marker, "idea", null, Instant.parse("2026-01-01T10:00:00Z"));

        // 字符串序会把 ".500Z" 排在 "Z" 之前；按真实时间应从新到旧。
        assertEquals(List.of(halfSecond, wholeSecond),
                ids(data.findActive(null, marker, Sort.UPDATED_DESC, 10, 0)));
    }

    /** LIMIT/OFFSET 由绑定参数传入，分页顺序与完整查询一致。 */
    @Test
    void findActiveAppliesLimitAndOffset() {
        String marker = "page-" + UUID.randomUUID();
        String first = UUID.randomUUID().toString();
        String second = UUID.randomUUID().toString();
        String third = UUID.randomUUID().toString();
        saveProject(first, "one-" + marker, marker, "idea", null, Instant.parse("2026-01-01T01:00:00Z"));
        saveProject(second, "two-" + marker, marker, "idea", null, Instant.parse("2026-01-01T02:00:00Z"));
        saveProject(third, "three-" + marker, marker, "idea", null, Instant.parse("2026-01-01T03:00:00Z"));

        assertEquals(List.of(third, second), ids(data.findActive(null, marker, Sort.UPDATED_DESC, 2, 0)));
        assertEquals(List.of(first), ids(data.findActive(null, marker, Sort.UPDATED_DESC, 2, 2)));
        assertEquals(List.of(), ids(data.findActive(null, marker, Sort.UPDATED_DESC, 2, 3)));
    }

    /** stage 为 null 时不筛选；提供时只返回对应阶段。 */
    @Test
    void findActiveFiltersByOptionalStage() {        String marker = "stage-" + UUID.randomUUID();
        String idea = UUID.randomUUID().toString();
        String editing = UUID.randomUUID().toString();
        saveProject(idea, "idea-" + marker, marker, "idea", null, Instant.parse("2026-01-01T01:00:00Z"));
        saveProject(editing, "editing-" + marker, marker, "editing", null, Instant.parse("2026-01-01T02:00:00Z"));

        assertEquals(2, data.findActive(null, marker, Sort.UPDATED_DESC, 10, 0).size());
        assertEquals(List.of(editing), ids(data.findActive("editing", marker, Sort.UPDATED_DESC, 10, 0)));
        assertEquals(List.of(), ids(data.findActive("done", marker, Sort.UPDATED_DESC, 10, 0)));
    }

    /** 名称和简介的搜索都不区分大小写。 */
    @Test
    void findActiveSearchesNameAndTaglineIgnoringCase() {
        String marker = "Case-" + UUID.randomUUID();
        String id = UUID.randomUUID().toString();
        saveProject(id, "Project-" + marker, "简介 " + marker, "idea", null, CREATED_AT);

        assertEquals(List.of(id), ids(data.findActive(null, "project-" + marker.toLowerCase(),
                Sort.UPDATED_DESC, 10, 0)));
        assertEquals(List.of(id), ids(data.findActive(null, marker.toUpperCase(),
                Sort.UPDATED_DESC, 10, 0)));
    }

    /** 空关键词匹配所有活动项目。 */
    @Test
    void findActiveTreatsEmptyKeywordAsMatchAll() {
        String marker = "empty-" + UUID.randomUUID();
        String id = UUID.randomUUID().toString();
        saveProject(id, "任意名称-" + marker, marker, "idea", null, CREATED_AT);

        List<String> ids = ids(data.findActive(null, "", Sort.UPDATED_DESC, 10, 0));

        assertTrue(ids.contains(id));
    }

    /** etag 匹配时更新所有字段，并写入新的 etag 与更新时间。 */
    @Test
    void updateIfMatchUpdatesWhenEtagMatches() {
        String id = UUID.randomUUID().toString();
        String etag = saveProject(id, "原名称", "原简介", "idea", 1000L, CREATED_AT);

        Instant updatedAt = Instant.parse("2026-02-02T10:00:00Z");
        int changed = data.updateIfMatch(id, etag,
                new ProjectChanges("新名称", "新简介", "editing", "genome-x", 45000L), updatedAt, "etag-2");

        assertEquals(1, changed);
        ProjectData found = data.findActiveById(id).orElseThrow();
        assertEquals("新名称", found.name());
        assertEquals("新简介", found.tagline());
        assertEquals("editing", found.stage());
        assertEquals("genome-x", found.genomeId());
        assertEquals(45000L, found.targetDurationMs());
        assertEquals(updatedAt.toString(), found.updatedAt());
        assertEquals("etag-2", found.etag());
    }

    /** etag 不匹配时返回 0，数据保持不变。 */
    @Test
    void updateIfMatchReturnsZeroWhenEtagDiffers() {
        String id = UUID.randomUUID().toString();
        String etag = saveProject(id, "稳定名称", "稳定简介", "idea", 1000L, CREATED_AT);

        int changed = data.updateIfMatch(id, "stale-etag",
                new ProjectChanges("不应写入", "", "idea", null, null), Instant.parse("2026-02-02T10:00:00Z"),
                "etag-2");

        assertEquals(0, changed);
        ProjectData found = data.findActiveById(id).orElseThrow();
        assertEquals("稳定名称", found.name());
        assertEquals(etag, found.etag());
    }

    /** 已归档项目不参与条件更新。 */
    @Test
    void updateIfMatchRefusesArchivedProject() {
        String id = UUID.randomUUID().toString();
        String etag = saveProject(id, "将归档", "", "idea", null, CREATED_AT);
        jdbc.update("UPDATE projects SET archived = 1 WHERE id = ?", id);

        int changed = data.updateIfMatch(id, etag,
                new ProjectChanges("修改", "", "idea", null, null), Instant.parse("2026-02-02T10:00:00Z"), "etag-2");

        assertEquals(0, changed);
    }

    /** 条件更新写入 null 目标时长后，读回仍是 null。 */
    @Test
    void updateIfMatchWritesNullTargetDuration() {
        String id = UUID.randomUUID().toString();
        String etag = saveProject(id, "有目标时长", "", "idea", 60000L, CREATED_AT);

        int changed = data.updateIfMatch(id, etag,
                new ProjectChanges("清空目标时长", "", "idea", null, null), Instant.parse("2026-02-02T10:00:00Z"),
                "etag-null");

        assertEquals(1, changed);
        ProjectData found = data.findActiveById(id).orElseThrow();
        assertNull(found.targetDurationMs());
    }

    private static List<String> ids(List<ProjectData> rows) {
        return rows.stream().map(ProjectData::id).toList();
    }
}
