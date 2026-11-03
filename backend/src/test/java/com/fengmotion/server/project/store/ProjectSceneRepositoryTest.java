package com.fengmotion.server.project.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
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

/**
 * 项目当前场景的版本与条件更新。
 *
 * <p>要验的核心是<strong>「版本已变就不写」</strong>：
 * 这是防住连续修改互相覆盖的唯一机制，所以失败路径比成功路径更重要。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ProjectSceneRepositoryTest {

    @Autowired
    private ProjectSceneRepository scenes;

    @Autowired
    private ProjectRepository projects;

    @Autowired
    private ObjectMapper json;

    /**
     * 造一个项目，返回其 ID。
     *
     * @return 项目 ID
     */
    private String newProject() {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "场景测试", "explainer", null, "/tmp/scene-" + id, Instant.now()));
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
    @DisplayName("从未写入过时读不到场景")
    void emptyWhenNeverWritten() {
        assertTrue(scenes.find(newProject()).isEmpty());
    }

    @Test
    @DisplayName("期望版本 0 时首次写入成功，版本变为 1")
    void firstWriteCreatesVersionOne() {
        String projectId = newProject();

        Optional<Long> version = scenes.updateIfVersionMatches(projectId, 0, film("第一版"), "task-1");

        assertEquals(Optional.of(1L), version);
        ProjectScene stored = scenes.find(projectId).orElseThrow();
        assertEquals(1L, stored.version());
        assertEquals("第一版", stored.film().path("scenes").get(0).path("text").asText());
        assertEquals("task-1", stored.taskId());
    }

    @Test
    @DisplayName("期望版本 0 但已存在场景：写入被拒（不覆盖）")
    void secondWriteWithVersionZeroRejected() {
        String projectId = newProject();
        scenes.updateIfVersionMatches(projectId, 0, film("第一版"), "task-1");

        Optional<Long> second = scenes.updateIfVersionMatches(projectId, 0, film("想覆盖"), "task-2");

        assertTrue(second.isEmpty());
        assertEquals("第一版", scenes.find(projectId).orElseThrow()
                .film().path("scenes").get(0).path("text").asText());
    }

    @Test
    @DisplayName("版本匹配时写入成功并递增")
    void matchingVersionSucceeds() {
        String projectId = newProject();
        scenes.updateIfVersionMatches(projectId, 0, film("第一版"), "task-1");

        Optional<Long> second = scenes.updateIfVersionMatches(projectId, 1, film("第二版"), "task-2");

        assertEquals(Optional.of(2L), second);
        assertEquals("第二版", scenes.find(projectId).orElseThrow()
                .film().path("scenes").get(0).path("text").asText());
        assertEquals("task-2", scenes.find(projectId).orElseThrow().taskId());
    }

    @Test
    @DisplayName("版本已变时写入被拒，已有内容不被覆盖")
    void staleVersionRejected() {
        String projectId = newProject();
        scenes.updateIfVersionMatches(projectId, 0, film("第一版"), "task-1");
        scenes.updateIfVersionMatches(projectId, 1, film("第二版"), "task-2");

        // 第三个任务仍以版本 1 为条件提交：它基于过时快照，必须被拒绝
        Optional<Long> third = scenes.updateIfVersionMatches(projectId, 1, film("基于旧版的修改"), "task-3");

        assertTrue(third.isEmpty());
        ProjectScene latest = scenes.find(projectId).orElseThrow();
        assertEquals(2L, latest.version());
        assertEquals("第二版", latest.film().path("scenes").get(0).path("text").asText());
    }

    @Test
    @DisplayName("连续两次修改：第二次基于第一次的结果，两次改动都保留")
    void consecutiveEditsAccumulate() {
        String projectId = newProject();

        // 第一次：设置文字
        JsonNode v1 = film("第一次的文字");
        scenes.updateIfVersionMatches(projectId, 0, v1, "task-1");

        // 第二次：基于版本 1 再改（拼上颜色），模拟「只改颜色不动文字」
        ProjectScene base = scenes.find(projectId).orElseThrow();
        JsonNode v2 = base.film().deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) v2.path("scenes").get(0)).put("color", "#ff0000");
        Optional<Long> committed = scenes.updateIfVersionMatches(projectId, base.version(), v2, "task-2");

        assertEquals(Optional.of(2L), committed);
        JsonNode finalScene = scenes.find(projectId).orElseThrow().film().path("scenes").get(0);
        // 两次修改都在：第一次的文字没有被第二次覆盖
        assertEquals("第一次的文字", finalScene.path("text").asText());
        assertEquals("#ff0000", finalScene.path("color").asText());
    }

    @Test
    @DisplayName("溯源字段记录了产生该版本的任务")
    void taskIdIsTraceable() {
        String projectId = newProject();
        scenes.updateIfVersionMatches(projectId, 0, film("一"), "task-origin");

        ProjectScene stored = scenes.find(projectId).orElseThrow();
        assertNotNull(stored.taskId());
        assertEquals("task-origin", stored.taskId());
        assertFalse(stored.updatedAt() == null);
    }
}
