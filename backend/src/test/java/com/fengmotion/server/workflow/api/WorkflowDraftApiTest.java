package com.fengmotion.server.workflow.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.workflow.service.WorkflowProjectService;

/**
 * 工作稿文件端点。
 *
 * <p>要验的核心是<strong>「不静默覆盖」</strong>：agent 和用户都会改这两份文件，
 * 任何一方基于旧内容的写入都必须被拒绝，而不是把对方的修改盖掉。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class WorkflowDraftApiTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired ProjectRepository projects;
    @Autowired WorkflowProjectService workflow;
    @Autowired ProjectOperationLock operations;

    @TempDir Path tempDir;

    private String newProject(boolean initialized) throws Exception {
        String id = UUID.randomUUID().toString();
        Path root = tempDir.resolve("proj-" + id);
        Files.createDirectories(root);
        projects.save(new Project(id, "工作稿测试", "explainer", null, root.toString(), Instant.now()));
        if (initialized) workflow.init(id, "做一条关于清晨咖啡店的短片");
        return id;
    }

    private Path root(String projectId) {
        return Path.of(projects.findById(projectId).orElseThrow().rootPath());
    }

    private String body(String content, String base) throws Exception {
        Map<String, Object> value = new HashMap<>();
        value.put("content", content);
        value.put("baseSha256", base);
        return json.writeValueAsString(value);
    }

    private String sha(String projectId, String name) throws Exception {
        var response = mvc.perform(get("/api/projects/{id}/workflow/drafts/{name}", projectId, name))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).path("sha256").asText(null);
    }

    @Test
    @DisplayName("列表给出两份工作稿，刚初始化时都是模板原样")
    void listsBothDraftsAsTemplates() throws Exception {
        String id = newProject(true);
        mvc.perform(get("/api/projects/{id}/workflow/drafts", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].name").value("lookdev-brief"))
                .andExpect(jsonPath("$[0].exists").value(true))
                .andExpect(jsonPath("$[0].template").value(true))
                .andExpect(jsonPath("$[0].content").doesNotExist())
                .andExpect(jsonPath("$[1].name").value("film-plan"));
    }

    @Test
    @DisplayName("带正确 sha256 写入：逐字落盘，模板标记变为 false")
    void writesWithMatchingSha() throws Exception {
        String id = newProject(true);
        String text = "# 视觉构想\n\n暖色调，晨光从左侧斜射。\n";
        mvc.perform(put("/api/projects/{id}/workflow/drafts/lookdev-brief", id)
                        .contentType(MediaType.APPLICATION_JSON).content(body(text, sha(id, "lookdev-brief"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value(text))
                .andExpect(jsonPath("$.template").value(false));
        assertEquals(text, Files.readString(root(id).resolve("lookdev-brief.md")));
    }

    @Test
    @DisplayName("文件在编辑期间被改过（如 agent 写入）：409，不覆盖")
    void rejectsStaleSha() throws Exception {
        String id = newProject(true);
        String base = sha(id, "film-plan");
        Path file = root(id).resolve("film-plan.md");
        Files.writeString(file, "agent 刚写的导演处理");

        mvc.perform(put("/api/projects/{id}/workflow/drafts/film-plan", id)
                        .contentType(MediaType.APPLICATION_JSON).content(body("用户的旧版本", base)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("draft_conflict"));
        assertEquals("agent 刚写的导演处理", Files.readString(file));
    }

    @Test
    @DisplayName("文件已存在却不带 sha256：409，必须先读再写")
    void rejectsMissingShaForExistingFile() throws Exception {
        String id = newProject(true);
        mvc.perform(put("/api/projects/{id}/workflow/drafts/film-plan", id)
                        .contentType(MediaType.APPLICATION_JSON).content(body("盲写", null)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("draft_conflict"));
    }

    @Test
    @DisplayName("文件不存在时不带 sha256 可以新建")
    void createsMissingFileWithoutSha() throws Exception {
        String id = newProject(true);
        Files.delete(root(id).resolve("film-plan.md"));
        mvc.perform(get("/api/projects/{id}/workflow/drafts/film-plan", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.exists").value(false))
                .andExpect(jsonPath("$.content").value(""));
        mvc.perform(put("/api/projects/{id}/workflow/drafts/film-plan", id)
                        .contentType(MediaType.APPLICATION_JSON).content(body("新的导演处理", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.exists").value(true));
    }

    @Test
    @DisplayName("项目正在制作：409 project_busy，文件不动")
    void rejectsWhileProjectBusy() throws Exception {
        String id = newProject(true);
        String base = sha(id, "lookdev-brief");
        String before = Files.readString(root(id).resolve("lookdev-brief.md"));
        operations.acquire(id);
        try {
            mvc.perform(put("/api/projects/{id}/workflow/drafts/lookdev-brief", id)
                            .contentType(MediaType.APPLICATION_JSON).content(body("改动", base)))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.error.code").value("project_busy"));
        } finally {
            operations.release(id);
        }
        assertEquals(before, Files.readString(root(id).resolve("lookdev-brief.md")));
    }

    @Test
    @DisplayName("只开放两份工作稿：其他名称 404，不能借此读写任意文件")
    void rejectsUnknownDraft() throws Exception {
        String id = newProject(true);
        mvc.perform(get("/api/projects/{id}/workflow/drafts/prompt.original", id))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/projects/{id}/workflow/drafts/decisions", id)
                        .contentType(MediaType.APPLICATION_JSON).content(body("x", null)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("超过大小上限：400，文件不动")
    void rejectsOversizedContent() throws Exception {
        String id = newProject(true);
        mvc.perform(put("/api/projects/{id}/workflow/drafts/lookdev-brief", id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("字".repeat(70_000), sha(id, "lookdev-brief"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("validation_error"));
    }

    @Test
    @DisplayName("未初始化的项目：400 workflow_not_initialized")
    void rejectsUninitializedProject() throws Exception {
        String id = newProject(false);
        mvc.perform(get("/api/projects/{id}/workflow/drafts", id))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("workflow_not_initialized"));
    }

    @Test
    @DisplayName("工作稿是符号链接：拒绝读写，不跟随到目录外")
    void rejectsSymlink() throws Exception {
        String id = newProject(true);
        Path outside = Files.writeString(tempDir.resolve("outside.md"), "目录外的文件");
        Path link = root(id).resolve("film-plan.md");
        Files.delete(link);
        Files.createSymbolicLink(link, outside);
        mvc.perform(get("/api/projects/{id}/workflow/drafts/film-plan", id))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("draft_unsafe"));
        mvc.perform(put("/api/projects/{id}/workflow/drafts/film-plan", id)
                        .contentType(MediaType.APPLICATION_JSON).content(body("覆盖", null)))
                .andExpect(status().isConflict());
        assertEquals("目录外的文件", Files.readString(outside));
    }

    @Test
    @DisplayName("状态接口报告原文完整性：正常为 ok，被旧版拼接污染为 suspect")
    void stateReportsOriginalIntegrity() throws Exception {
        String clean = newProject(true);
        mvc.perform(get("/api/projects/{id}/workflow", clean))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.originalIntegrity").value("ok"))
                .andExpect(jsonPath("$.originalIntegrityReasons.length()").value(0));

        String polluted = newProject(false);
        workflow.init(polluted, "做咖啡短片\n\n做咖啡短片\n\n暖色调\ndraft");
        mvc.perform(get("/api/projects/{id}/workflow", polluted))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.originalIntegrity").value("suspect"));

        String fresh = newProject(false);
        mvc.perform(get("/api/projects/{id}/workflow", fresh))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.originalIntegrity").doesNotExist());
    }
}
