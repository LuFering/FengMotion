package com.fengmotion.server.project.api;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.MediaType;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 验证项目创建接口当前的响应与参数校验。 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional 
class ProjectApiTest {
    @Autowired 
    private  MockMvc mvc;

    @TempDir 
    Path tempDir;

    /** 空白名称返回当前异常处理器定义的 400 响应。 */
    @Test
    void rejectsBlankProjectName() throws Exception{
        String requestBody = """
            {
              "name": "   "
            }
            """;
        
        mvc.perform(post("/api/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("validation_error"))
            .andExpect(jsonPath("$.error.message").value("项目名称不能为空"));
    }


    /** 相对项目路径不符合绝对路径要求。 */
    @Test
    void rejectsRelativeProjectPath() throws Exception {
        mvc.perform(post("/api/projects")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"测试项目\",\"rootPath\":\"relative\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_error"));
    }

    /** 目录已存在时返回冲突，不覆盖已有内容。 */
    @Test
    void rejectsExistingProjectDirectory() throws Exception {
        Path projectPath = Files.createDirectory(tempDir.resolve("existing"));
        Path marker = Files.writeString(projectPath.resolve("marker.txt"), "原有内容");
        String body = """
                {"name": "测试项目", "rootPath": "%s"}
                """.formatted(projectPath);

        mvc.perform(post("/api/projects")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("conflict"));

        assertTrue(Files.exists(marker));
    }

    @Autowired
    private com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    /** 幂等重试返回同一个项目，列表和详情均可查询。 */
    @Test
    void createsIdempotentlyAndQueriesProject() throws Exception {
        String path = tempDir.resolve("idempotent").toString();
        String body = objectMapper.writeValueAsString(java.util.Map.of(
                "name", "项目 A", "rootPath", path, "genomeId", "g1", "targetDurationMs", 60000));
        String key = java.util.UUID.randomUUID().toString();
        String first = mvc.perform(post("/api/projects").header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.settings.width").value(1920))
                .andExpect(jsonPath("$.counts.scenes").value(0))
                .andReturn().getResponse().getContentAsString();
        String id = objectMapper.readTree(first).get("id").asText();
        String second = mvc.perform(post("/api/projects").header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        org.junit.jupiter.api.Assertions.assertEquals(id, objectMapper.readTree(second).get("id").asText());
        mvc.perform(post("/api/projects").header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(body.replace("项目 A", "项目 B")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("idempotency_conflict"));
        mvc.perform(get("/api/projects/{id}", id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id));
        mvc.perform(get("/api/projects").param("q", "项目 A")).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(id));
        mvc.perform(get("/api/projects/missing")).andExpect(status().isNotFound());
    }

    /** 默认删除是归档：项目从列表与详情消失，目录保留；物理删除仍返回能力不可用。 */
    @Test
    void archivesProjectByDefaultAndRejectsPurge() throws Exception {
        Path path = tempDir.resolve("archivable");
        String body = objectMapper.writeValueAsString(java.util.Map.of("name", "待归档", "rootPath", path.toString()));
        String created = mvc.perform(post("/api/projects").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = objectMapper.readTree(created).get("id").asText();

        // 物理删除尚未接入，不静默降级成归档。
        mvc.perform(delete("/api/projects/{id}", id).param("purge", "true"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("capability_unavailable"));

        mvc.perform(delete("/api/projects/{id}", id)).andExpect(status().isNoContent());
        mvc.perform(get("/api/projects/{id}", id)).andExpect(status().isNotFound());
        mvc.perform(get("/api/projects").param("q", "待归档"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
        // 归档不动目录，也不删除数据行。
        assertTrue(Files.isDirectory(path));

        // 重复删除按不存在处理。
        mvc.perform(delete("/api/projects/{id}", id)).andExpect(status().isNotFound());
    }

    @Test
    void updatesWithEtag() throws Exception {
        Path path = tempDir.resolve("editable");
        String body = objectMapper.writeValueAsString(java.util.Map.of("name", "原名称", "rootPath", path.toString()));
        String created = mvc.perform(post("/api/projects").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        var json = objectMapper.readTree(created);
        String id = json.get("id").asText();
        String etag = json.get("etag").asText();
        mvc.perform(patch("/api/projects/{id}", id).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"新名称\"}"))
                .andExpect(status().isPreconditionFailed());
        mvc.perform(patch("/api/projects/{id}", id).header("If-Match", etag)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"新名称\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("新名称"));
        mvc.perform(patch("/api/projects/{id}", id).header("If-Match", etag)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"旧修改\"}"))
                .andExpect(status().isPreconditionFailed());
        mvc.perform(get("/api/projects/{id}", id)).andExpect(status().isOk());
        assertTrue(Files.isDirectory(path));
    }

    @Test
    void createProjectAndReturnsGenerateFields() throws Exception{
        Path projectPath = tempDir.resolve("test-project");

        String requestBody = """
            {
              "name": "测试项目",
              "genomeId": "genome-001",
              "targetDurationMs": 60000,
              "rootPath": "%s"
            }
            """.formatted(projectPath);

        mvc.perform(post("/api/projects")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(requestBody))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").isNotEmpty())
            .andExpect(jsonPath("$.name").value("测试项目"))
            .andExpect(jsonPath("$.targetDurationMs").value(60000))
            .andExpect(jsonPath("$.createdAt").isNotEmpty());

        assertTrue(Files.isDirectory(projectPath));
    }
}
