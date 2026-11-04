package com.fengmotion.server.project.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.domain.ProjectSceneVersion;

/**
 * 场景历史快照的写入与读取。
 *
 * <p>要验的核心是「当前场景与历史快照永远一致」：
 * 版本号推进了就必须有对应快照，写入被拒就不该留下快照。
 * 这两条一旦破了，回退列表就会与真实场景脱节，而脱节无法事后修复。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ProjectSceneSnapshotTest {

    @Autowired
    private ProjectSceneRepository scenes;

    @Autowired
    private ProjectRepository projects;

    @Autowired
    private ObjectMapper json;

    /**
     * 造一个项目。
     *
     * @return 项目 ID
     */
    private String newProject() {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "快照测试", "explainer", null, "/tmp/snap-" + id, Instant.now()));
        return id;
    }

    /**
     * 造一份最小 film。
     *
     * @param text 字幕
     * @return film 节点
     */
    private JsonNode film(String text) {
        try {
            return json.readTree("{\"width\":640,\"height\":360,\"fps\":30,\"scenes\":["
                    + "{\"id\":\"s1\",\"text\":\"" + text + "\",\"durationSeconds\":2}]}");
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("提交成功后留下该版本的快照")
    void commitWritesSnapshot() {
        String projectId = newProject();

        Optional<Long> version = scenes.commitWithSnapshot(projectId, 0, film("第一版"), "task-1",
                "把标题改成第一版", "text → 第一版", "renders/a.mp4",
                ProjectSceneVersion.SOURCE_TASK, null);

        assertEquals(Optional.of(1L), version);
        ProjectSceneVersion snapshot = scenes.findVersion(projectId, 1).orElseThrow();
        assertEquals("第一版", snapshot.film().path("scenes").get(0).path("text").asText());
        assertEquals("task-1", snapshot.taskId());
        assertEquals("把标题改成第一版", snapshot.prompt());
        assertEquals("text → 第一版", snapshot.editSummary());
        assertEquals("renders/a.mp4", snapshot.artifactPath());
        assertEquals(ProjectSceneVersion.SOURCE_TASK, snapshot.source());
        assertNull(snapshot.fromVersion());
        assertFalse(snapshot.restored());
    }

    @Test
    @DisplayName("版本被拒时不留下快照")
    void rejectedCommitLeavesNoSnapshot() {
        String projectId = newProject();
        scenes.commitWithSnapshot(projectId, 0, film("第一版"), "task-1",
                "一", "", null, ProjectSceneVersion.SOURCE_TASK, null);

        // 基于版本 0 再提交一次：当前已是版本 1，必须失败
        Optional<Long> rejected = scenes.commitWithSnapshot(projectId, 0, film("不该出现"), "task-2",
                "二", "", null, ProjectSceneVersion.SOURCE_TASK, null);

        assertTrue(rejected.isEmpty());
        assertEquals(1, scenes.listVersions(projectId).size(), "失败提交不能写进历史");
        assertEquals("第一版", scenes.find(projectId).orElseThrow()
                .film().path("scenes").get(0).path("text").asText());
    }

    @Test
    @DisplayName("多版提交后历史完整，新版本在前")
    void listsVersionsNewestFirst() {
        String projectId = newProject();
        scenes.commitWithSnapshot(projectId, 0, film("一"), "t1", "p1", "s1", null,
                ProjectSceneVersion.SOURCE_TASK, null);
        scenes.commitWithSnapshot(projectId, 1, film("二"), "t2", "p2", "s2", null,
                ProjectSceneVersion.SOURCE_TASK, null);
        scenes.commitWithSnapshot(projectId, 2, film("三"), "t3", "p3", "s3", null,
                ProjectSceneVersion.SOURCE_TASK, null);

        List<ProjectSceneVersion> versions = scenes.listVersions(projectId);

        assertEquals(3, versions.size());
        assertEquals(List.of(3L, 2L, 1L), versions.stream().map(ProjectSceneVersion::version).toList());
        assertEquals("三", versions.get(0).film().path("scenes").get(0).path("text").asText());
        assertEquals("一", versions.get(2).film().path("scenes").get(0).path("text").asText());
    }

    @Test
    @DisplayName("回退版本记录来源版本，且与任务版本可区分")
    void restoreVersionRecordsOrigin() {
        String projectId = newProject();
        scenes.commitWithSnapshot(projectId, 0, film("原始"), "t1", "p1", "s1", "renders/a.mp4",
                ProjectSceneVersion.SOURCE_TASK, null);
        scenes.commitWithSnapshot(projectId, 1, film("改过"), "t2", "p2", "s2", "renders/b.mp4",
                ProjectSceneVersion.SOURCE_TASK, null);

        // 回退到版本 1：新版本号是 3，内容等于版本 1
        Optional<Long> restored = scenes.commitWithSnapshot(projectId, 2, film("原始"), null,
                "回退到版本 1", "回退到版本 1", "renders/a.mp4",
                ProjectSceneVersion.SOURCE_RESTORE, 1L);

        assertEquals(Optional.of(3L), restored);
        ProjectSceneVersion snapshot = scenes.findVersion(projectId, 3).orElseThrow();
        assertEquals(ProjectSceneVersion.SOURCE_RESTORE, snapshot.source());
        assertEquals(1L, snapshot.fromVersion());
        assertTrue(snapshot.restored());
        assertNull(snapshot.taskId(), "回退不是任务产生的，不该编造 taskId");
        // 历史是新增而非改写：原版本 2 仍在
        assertEquals("改过", scenes.findVersion(projectId, 2).orElseThrow()
                .film().path("scenes").get(0).path("text").asText());
    }

    @Test
    @DisplayName("没有历史时返回空列表而不是报错")
    void emptyHistoryIsNotAnError() {
        assertEquals(List.of(), scenes.listVersions(newProject()));
    }

    @Test
    @DisplayName("读不存在的版本返回空")
    void missingVersionIsEmpty() {
        String projectId = newProject();
        scenes.commitWithSnapshot(projectId, 0, film("一"), "t1", "p", "s", null,
                ProjectSceneVersion.SOURCE_TASK, null);

        assertTrue(scenes.findVersion(projectId, 99).isEmpty());
    }

    @Test
    @DisplayName("版本不跨项目串号")
    void versionsAreScopedToProject() {
        String a = newProject();
        String b = newProject();
        scenes.commitWithSnapshot(a, 0, film("A 的内容"), "t1", "p", "s", null,
                ProjectSceneVersion.SOURCE_TASK, null);
        scenes.commitWithSnapshot(b, 0, film("B 的内容"), "t2", "p", "s", null,
                ProjectSceneVersion.SOURCE_TASK, null);

        assertEquals(1, scenes.listVersions(a).size());
        assertEquals("A 的内容", scenes.findVersion(a, 1).orElseThrow()
                .film().path("scenes").get(0).path("text").asText());
        assertEquals("B 的内容", scenes.findVersion(b, 1).orElseThrow()
                .film().path("scenes").get(0).path("text").asText());
    }

    @Test
    @DisplayName("旧接口 updateIfVersionMatches 不写快照，保持原有语义")
    void legacyUpdateDoesNotWriteSnapshot() {
        String projectId = newProject();

        scenes.updateIfVersionMatches(projectId, 0, film("一"), "t1");

        assertEquals(1L, scenes.find(projectId).orElseThrow().version());
        assertEquals(List.of(), scenes.listVersions(projectId),
                "不带快照的写入口不应产生历史，避免历史与真实提交混在一起");
    }
}
