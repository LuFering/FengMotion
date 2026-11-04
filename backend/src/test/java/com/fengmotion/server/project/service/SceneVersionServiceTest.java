package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

/**
 * 场景回退。
 *
 * <p>核心要验的不是「能退回去」，而是<strong>回退之后版本号仍然单调递增</strong>。
 * 只要回退是「把 version 改小」，一个基于旧版本号的在途任务就会意外匹配成功，
 * 把回退结果覆盖掉 —— 这正是没有历史快照之前最隐蔽的那类数据事故。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class SceneVersionServiceTest {

    @Autowired
    private SceneVersionService service;

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
        projects.save(new Project(id, "回退测试", "explainer", null, "/tmp/restore-" + id, Instant.now()));
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

    /**
     * 提交一个版本。
     *
     * @param projectId 项目
     * @param base      基线版本
     * @param text      字幕
     * @param taskId    任务
     */
    private void commit(String projectId, long base, String text, String taskId) {
        scenes.commitWithSnapshot(projectId, base, film(text), taskId,
                "把文字改成 " + text, "text → " + text, null,
                ProjectSceneVersion.SOURCE_TASK, null);
    }

    @Test
    @DisplayName("回退新增一个版本，内容等于目标版本")
    void restoreAddsNewVersionWithTargetContent() {
        String projectId = newProject();
        commit(projectId, 0, "原始", "t1");
        commit(projectId, 1, "改坏了", "t2");

        ProjectSceneVersion restored = service.restore(projectId, 1, null);

        assertEquals(3L, restored.version(), "回退产生新版本号，不是退回旧号");
        assertEquals("原始", restored.film().path("scenes").get(0).path("text").asText());
        assertEquals(ProjectSceneVersion.SOURCE_RESTORE, restored.source());
        assertEquals(1L, restored.fromVersion());
        // 当前场景同步更新
        assertEquals(3L, scenes.find(projectId).orElseThrow().version());
        assertEquals("原始", scenes.find(projectId).orElseThrow()
                .film().path("scenes").get(0).path("text").asText());
    }

    @Test
    @DisplayName("回退不会删除历史：三版全在，可再回退掉回退")
    void historyIsPreservedAfterRestore() {
        String projectId = newProject();
        commit(projectId, 0, "A", "t1");
        commit(projectId, 1, "B", "t2");
        service.restore(projectId, 1, null);

        assertEquals(3, service.list(projectId).size(), "回退是新增，历史不减");
        // 版本 1=A、版本 2=B、版本 3=回退到 1 的内容(A)。历史里 B 仍然在。
        assertEquals("A", service.get(projectId, 1).film().path("scenes").get(0).path("text").asText());
        assertEquals("B", service.get(projectId, 2).film().path("scenes").get(0).path("text").asText());

        // 再退回到版本 2（被改坏的那版）：说明回退本身也可以被回退
        ProjectSceneVersion again = service.restore(projectId, 2, null);
        assertEquals(4L, again.version());
        assertEquals("B", again.film().path("scenes").get(0).path("text").asText());
        assertEquals(List.of(4L, 3L, 2L, 1L),
                service.list(projectId).stream().map(ProjectSceneVersion::version).toList());
    }

    @Test
    @DisplayName("回退后，基于旧版本号的在途任务无法覆盖回退结果")
    void staleTaskCannotOverwriteRestore() {
        String projectId = newProject();
        commit(projectId, 0, "A", "t1");
        commit(projectId, 1, "B", "t2");

        /* 模拟在途任务：它在回退发生之前读到了版本 2 作为基线 */
        long inFlightBase = 2L;

        service.restore(projectId, 1, null); // 当前变成版本 3，内容 A

        // 该任务现在提交：条件基于 2，而当前是 3，必须失败
        var stale = scenes.commitWithSnapshot(projectId, inFlightBase, film("在途任务的改动"), "t9",
                "x", "x", null, ProjectSceneVersion.SOURCE_TASK, null);

        assertTrue(stale.isEmpty(), "过时基线的任务必须被拒绝，否则会覆盖回退结果");
        assertEquals("A", scenes.find(projectId).orElseThrow()
                .film().path("scenes").get(0).path("text").asText());
    }

    @Test
    @DisplayName("调用方带的当前版本已过期时拒绝回退")
    void staleExpectedVersionRejected() {
        String projectId = newProject();
        commit(projectId, 0, "A", "t1");
        commit(projectId, 1, "B", "t2");
        commit(projectId, 2, "C", "t3");

        // 用户界面停在版本 2，实际已是 3
        ApiException e = assertThrows(ApiException.class,
                () -> service.restore(projectId, 1, 2L));

        assertEquals("scene_version_conflict", e.getCode());
        assertEquals(3L, scenes.find(projectId).orElseThrow().version(), "拒绝时不能改动场景");
    }

    @Test
    @DisplayName("当前版本校验通过时正常回退")
    void matchingExpectedVersionSucceeds() {
        String projectId = newProject();
        commit(projectId, 0, "A", "t1");
        commit(projectId, 1, "B", "t2");

        ProjectSceneVersion restored = service.restore(projectId, 1, 2L);

        assertEquals(3L, restored.version());
    }

    @Test
    @DisplayName("回退到当前版本是空操作，明确拒绝而不是默默新增一版")
    void restoringCurrentVersionRejected() {
        String projectId = newProject();
        commit(projectId, 0, "A", "t1");

        ApiException e = assertThrows(ApiException.class, () -> service.restore(projectId, 1, null));

        assertEquals("noop_restore", e.getCode());
        assertEquals(1L, scenes.find(projectId).orElseThrow().version());
    }

    @Test
    @DisplayName("版本不存在时 404")
    void missingTargetVersion() {
        String projectId = newProject();
        commit(projectId, 0, "A", "t1");

        ApiException e = assertThrows(ApiException.class, () -> service.restore(projectId, 99, null));

        assertEquals("not_found", e.getCode());
    }

    @Test
    @DisplayName("项目不存在时 404，不与「没有版本」混淆")
    void missingProject() {
        ApiException e = assertThrows(ApiException.class, () -> service.list("no-such-project"));
        assertEquals("not_found", e.getCode());
    }

    @Test
    @DisplayName("还没产生过快照的项目返回空列表")
    void projectWithoutSnapshots() {
        assertEquals(0, service.list(newProject()).size());
    }
}
