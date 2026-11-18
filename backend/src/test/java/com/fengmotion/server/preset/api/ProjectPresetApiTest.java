package com.fengmotion.server.preset.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.preset.domain.PresetMapping;
import com.fengmotion.server.preset.domain.WorkflowPreset;
import com.fengmotion.server.preset.store.WorkflowPresetRepository;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.skill.client.GithubArchiveClient;
import com.fengmotion.server.skill.domain.SkillPackage;
import com.fengmotion.server.skill.service.SkillPackageService;
import com.fengmotion.server.workflow.service.ProjectOperationLock;
import com.fengmotion.server.workflow.service.WorkflowProjectService;

/**
 * 视频类型落地到项目。
 *
 * <p>要验的核心：可以重复调用；用户写过的工作稿不覆盖；用户改过的指引先备份再替换；换类型时整体替换。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ProjectPresetApiTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired SkillPackageService skills;
    @Autowired WorkflowPresetRepository presets;
    @Autowired ProjectRepository projects;
    @Autowired WorkflowProjectService workflow;
    @Autowired ProjectOperationLock operations;
    @MockBean GithubArchiveClient github;

    @TempDir Path temp;

    private String project(boolean initialized) throws Exception {
        String id = UUID.randomUUID().toString();
        Path root = Files.createDirectories(temp.resolve("proj-" + id));
        projects.save(new Project(id, "预设测试", "explainer", null, root.toString(), Instant.now()));
        if (initialized) workflow.init(id, "给「晨光咖啡」做一条 8 秒 Logo 动画");
        return id;
    }

    private Path root(String projectId) {
        return Path.of(projects.findById(projectId).orElseThrow().rootPath());
    }

    private WorkflowPreset preset(SkillPackage pkg, String status, PresetMapping mapping) {
        Instant now = Instant.now();
        WorkflowPreset p = new WorkflowPreset(UUID.randomUUID().toString(), mapping.name(), mapping.description(), status,
                pkg.id(), pkg.owner() + "/" + pkg.repo(), PresetFixtures.SKILL, pkg.commitSha(), mapping,
                PresetMapping.VERSION, now, now, status.equals(WorkflowPreset.ACTIVE) ? now : null);
        presets.save(p);
        return p;
    }

    private JsonNode apply(String projectId, String presetId, int expected) throws Exception {
        String body = mvc.perform(post("/api/projects/{id}/workflow/preset", projectId).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("presetId", presetId))))
                .andExpect(status().is(expected)).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return json.readTree(body);
    }

    private static String action(JsonNode result, String draft) {
        for (JsonNode d : result.path("drafts")) if (d.path("name").asText().equals(draft)) return d.path("action").asText();
        return null;
    }

    @Test
    @DisplayName("落地：写入指引（含来源与优先级规则）、只读组件源码、记录；工作流模板原样的工作稿换成预设模板")
    void appliesToInitializedProject() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        WorkflowPreset logo = preset(pkg, WorkflowPreset.ACTIVE, PresetFixtures.mapping("Logo 动画", "# 视觉构想（Logo）"));
        String id = project(true);

        JsonNode result = apply(id, logo.id(), 200);
        assertEquals("written", result.path("guide").asText());
        assertEquals(1, result.path("componentsCopied").asInt());
        assertEquals("replaced", action(result, "lookdev-brief"), "init 写入的工作流模板可以替换");
        assertEquals("replaced", action(result, "film-plan"));

        Path root = root(id);
        String guide = Files.readString(root.resolve("skill-guide.md"));
        assertTrue(guide.contains(pkg.owner() + "/" + pkg.repo() + "@" + pkg.commitSha().substring(0, 12)), "注明来源");
        assertTrue(guide.contains("以原文和纠正为准"), "注明优先级");
        assertTrue(guide.contains("`bash scripts/check.sh` → 用本项目自己的渲染与检查替代"));
        assertTrue(guide.contains("（出处：" + PresetFixtures.SKILL));
        assertEquals("# 视觉构想（Logo）", Files.readString(root.resolve("lookdev-brief.md")));

        Path component = root.resolve(".fengmotion/skill-sources/" + PresetFixtures.COMPONENT);
        assertTrue(Files.isRegularFile(component));
        assertEquals(Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.GROUP_READ, PosixFilePermission.OTHERS_READ),
                Files.getPosixFilePermissions(component));

        mvc.perform(get("/api/projects/{id}/workflow/preset", id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.record.presetId").value(logo.id()))
                .andExpect(jsonPath("$.record.commitSha").value(pkg.commitSha()));
    }

    @Test
    @DisplayName("重复落地同一个类型：结果不变")
    void isIdempotent() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        WorkflowPreset logo = preset(pkg, WorkflowPreset.ACTIVE, PresetFixtures.mapping("Logo 动画", "# 视觉构想（Logo）"));
        String id = project(true);
        apply(id, logo.id(), 200);
        String before = Files.readString(root(id).resolve("skill-guide.md"));

        JsonNode again = apply(id, logo.id(), 200);
        assertEquals("unchanged", again.path("guide").asText());
        assertEquals("unchanged", action(again, "lookdev-brief"));
        assertEquals(logo.id(), again.path("previousPresetId").asText());
        assertEquals(before, Files.readString(root(id).resolve("skill-guide.md")));
    }

    @Test
    @DisplayName("用户写过的工作稿不覆盖；用户改过的指引先备份再替换")
    void respectsUserEdits() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        WorkflowPreset logo = preset(pkg, WorkflowPreset.ACTIVE, PresetFixtures.mapping("Logo 动画", "# 视觉构想（Logo）"));
        String id = project(true);
        Path root = root(id);
        Files.writeString(root.resolve("lookdev-brief.md"), "用户自己写的视觉构想");
        Files.writeString(root.resolve("skill-guide.md"), "用户手写的指引");

        JsonNode result = apply(id, logo.id(), 200);
        assertEquals("kept", action(result, "lookdev-brief"));
        assertEquals("用户自己写的视觉构想", Files.readString(root.resolve("lookdev-brief.md")));
        assertEquals("replaced", result.path("guide").asText());
        String backup = result.path("guideBackup").asText();
        assertEquals("用户手写的指引", Files.readString(root.resolve(backup)));
    }

    @Test
    @DisplayName("换成另一个类型：指引与上次写入的工作稿整体替换，记下之前的类型")
    void switchesPreset() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        WorkflowPreset a = preset(pkg, WorkflowPreset.ACTIVE, PresetFixtures.mapping("Logo 动画", "# 模板 A"));
        WorkflowPreset b = preset(pkg, WorkflowPreset.ACTIVE, PresetFixtures.mapping("Logo 揭示", "# 模板 B"));
        String id = project(false);

        assertEquals("written", action(apply(id, a.id(), 200), "lookdev-brief"), "文件不存在时直接写入");
        JsonNode result = apply(id, b.id(), 200);
        assertEquals(a.id(), result.path("previousPresetId").asText());
        assertEquals("replaced", result.path("guide").asText());
        assertTrue(result.path("guideBackup").isNull(), "上次是我们写的指引，不需要备份");
        assertEquals("replaced", action(result, "lookdev-brief"), "上次由预设写入且没被改过的工作稿可以替换");
        assertEquals("# 模板 B", Files.readString(root(id).resolve("lookdev-brief.md")));
        assertTrue(Files.readString(root(id).resolve("skill-guide.md")).contains("# 视频类型：Logo 揭示"));
    }

    @Test
    @DisplayName("草稿不能落地；项目正在制作时拒绝；skill 包删除后仍写指引但不复制组件")
    void guards() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        WorkflowPreset draft = preset(pkg, WorkflowPreset.DRAFT, PresetFixtures.mapping("Logo 动画", null));
        WorkflowPreset active = preset(pkg, WorkflowPreset.ACTIVE, PresetFixtures.mapping("Logo 动画", null));
        String id = project(false);

        assertEquals("preset_not_active", apply(id, draft.id(), 409).path("error").path("code").asText());
        operations.acquire(id);
        try {
            assertEquals("project_busy", apply(id, active.id(), 409).path("error").path("code").asText());
        } finally {
            operations.release(id);
        }
        assertFalse(Files.exists(root(id).resolve("skill-guide.md")), "被拒绝时不写任何文件");

        skills.delete(pkg.id());
        JsonNode result = apply(id, active.id(), 200);
        assertEquals(0, result.path("componentsCopied").asInt());
        assertTrue(result.path("warnings").toString().contains("组件源码没有复制"));
        assertNotNull(Files.readString(root(id).resolve("skill-guide.md")));

        String fresh = project(false);
        mvc.perform(get("/api/projects/{id}/workflow/preset", fresh)).andExpect(status().isOk())
                .andExpect(jsonPath("$.record").doesNotExist());
        mvc.perform(post("/api/projects/{id}/workflow/preset", fresh).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
    }
}
