package com.fengmotion.server.project.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

/**
 * 当前场景读接口。
 *
 * <p>重点验「尚未初始化」是一个明确状态，而不是编一份默认场景冒充已有内容。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
@DisplayName("当前场景读接口")
class ProjectSceneControllerTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ProjectRepository projects;

    @Autowired
    private ProjectSceneRepository scenes;

    @Autowired
    private ObjectMapper json;

    private String newProject() {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "场景读", "explainer", null, "/tmp/read-" + id, Instant.now()));
        return id;
    }

    private JsonNode film(String text) {
        try {
            return json.readTree("{\"width\":640,\"height\":360,\"fps\":30,\"scenes\":["
                    + "{\"id\":\"s1\",\"text\":\"" + text + "\",\"durationSeconds\":2}]}");
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("尚未初始化时返回 initialized=false 且 film=null，不编默认场景")
    void uninitializedIsExplicit() throws Exception {
        String projectId = newProject();

        String body = mvc.perform(get("/api/projects/{id}/scene", projectId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.initialized").value(false))
                .andExpect(jsonPath("$.version").value(0))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);

        JsonNode node = json.readTree(body);
        assertFalse(node.path("initialized").asBoolean());
        assertTrue(node.get("film") == null || node.get("film").isNull(),
                "未初始化时不能返回一份默认 film");
        assertNull(node.get("taskId") == null || node.get("taskId").isNull() ? null : node.get("taskId").asText());
    }

    @Test
    @DisplayName("项目不存在返回 404，与「未初始化」区分开")
    void unknownProjectIs404() throws Exception {
        mvc.perform(get("/api/projects/{id}/scene", "no-such-project"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("有场景时返回 film、version、taskId、updatedAt")
    void returnsCurrentScene() throws Exception {
        String projectId = newProject();
        scenes.updateIfVersionMatches(projectId, 0, film("当前内容"), "task-abc");

        String body = mvc.perform(get("/api/projects/{id}/scene", projectId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.initialized").value(true))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.taskId").value("task-abc"))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);

        JsonNode node = json.readTree(body);
        assertEquals("当前内容",
                node.path("film").path("scenes").get(0).path("text").asText());
        assertNotNull(node.get("updatedAt"));
    }

    @Test
    @DisplayName("版本推进后读到的版本与内容同步变化")
    void reflectsLatestVersion() throws Exception {
        String projectId = newProject();
        scenes.updateIfVersionMatches(projectId, 0, film("第一版"), "t1");
        scenes.updateIfVersionMatches(projectId, 1, film("第二版"), "t2");

        mvc.perform(get("/api/projects/{id}/scene", projectId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.taskId").value("t2"))
                .andExpect(jsonPath("$.film.scenes[0].text").value("第二版"));
    }
}
