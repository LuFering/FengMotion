package com.fengmotion.server.workflow.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

/**
 * 项目与 workflow-v5 的衔接。
 *
 * <p>要验的核心是<strong>「原文不被改写」</strong>：{@code prompt.original.md}
 * 是整条 Prompt-first 流程的创作依据，一旦被后来的摘要或模板覆盖，
 * 后续所有创作都建在错误输入上，而且无法恢复。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class WorkflowProjectServiceTest {

    @Autowired
    private WorkflowProjectService service;

    @Autowired
    private ProjectRepository projects;

    @TempDir
    Path tempDir;

    /**
     * 造一个有目录的项目。
     *
     * @return 项目 ID
     */
    private String newProject() throws Exception {
        String id = UUID.randomUUID().toString();
        Path root = tempDir.resolve("proj-" + id);
        Files.createDirectories(root);
        projects.save(new Project(id, "工作流测试", "explainer", null, root.toString(), Instant.now()));
        return id;
    }

    @Test
    @DisplayName("初始化后建出 Prompt-first 目录与原文")
    void initCreatesPromptFirstLayout() throws Exception {
        String projectId = newProject();
        String prompt = "做一条关于清晨咖啡店的短片";

        var state = service.init(projectId, prompt);

        assertTrue(state.initialized(), "应当已有 prompt.original.md");
        assertTrue(state.files().contains("prompt.original.md"));
        assertTrue(state.files().contains("lookdev-brief.md"), "模板骨架也应建出");
        Path root = Path.of(state.directory());
        assertEquals(prompt, Files.readString(root.resolve("prompt.original.md")).trim(),
                "原文必须逐字落盘");
        assertTrue(Files.isDirectory(root.resolve("qa").resolve("passes")),
                "qa/passes 目录是渲染记录的家");
    }

    @Test
    @DisplayName("再次初始化不覆盖用户原文")
    void initDoesNotOverwriteOriginal() throws Exception {
        String projectId = newProject();
        service.init(projectId, "最初的完整需求，写得很长很清楚。");

        // 模拟用户之后手改过原文
        var state = service.state(projectId);
        Path original = Path.of(state.directory()).resolve("prompt.original.md");
        Files.writeString(original, "用户后来改过的原文");

        // 再初始化一次（例如界面重复点击）
        service.init(projectId, "另一个需求");

        assertEquals("用户后来改过的原文", Files.readString(original).trim(),
                "原文一旦存在就不能被覆盖，否则创作依据丢失");
    }

    @Test
    @DisplayName("未初始化时状态如实为 false，不假装已就绪")
    void stateIsFalseBeforeInit() throws Exception {
        String projectId = newProject();

        var state = service.state(projectId);

        assertFalse(state.initialized());
        assertEquals(0, state.passes(), "没有渲染轮次就报 0");
    }

    @Test
    @DisplayName("没有需求时拒绝初始化，不用模板占位冒充原文")
    void initWithoutPromptIsRejected() throws Exception {
        String projectId = newProject();

        /* 曾经的缺陷：无需求时回落到模板，得到「initialized=true、原文 113 字」，
           而磁盘上存的是「（在这里粘贴用户原始高级提示词）」——
           用户以为创作依据已保存，实际是占位符。
           workflow-v5 明确要求 prompt.original.md 是用户原文。 */
        var e = assertThrows(com.fengmotion.server.common.ApiException.class,
                () -> service.init(projectId, null));
        assertEquals("workflow_prompt_required", e.getCode());
        assertFalse(service.state(projectId).initialized(), "拒绝后不应留下半成品上下文");
    }

    @Test
    @DisplayName("空白需求同样被拒绝")
    void initWithBlankPromptIsRejected() throws Exception {
        String projectId = newProject();
        var e = assertThrows(com.fengmotion.server.common.ApiException.class,
                () -> service.init(projectId, "   \n  "));
        assertEquals("workflow_prompt_required", e.getCode());
    }

    @Test
    @DisplayName("渲染轮次按 qa/passes 下的目录数如实计数")
    void countsPasses() throws Exception {
        String projectId = newProject();
        var state = service.init(projectId, "需求");
        Path passes = Path.of(state.directory()).resolve("qa").resolve("passes");
        Files.createDirectories(passes.resolve("01"));
        Files.createDirectories(passes.resolve("02"));

        assertEquals(2, service.state(projectId).passes());
    }

    @Test
    @DisplayName("工具目录可被解析到，否则整套流程无从运行")
    void workflowRootIsResolvable() {
        var runner = new WorkflowToolRunner();
        // 开发态布局：backend/ 与 desktop/workflow-v5 同级
        assertTrue(runner.resolveWorkflowRoot() != null,
                "测试环境下应能定位 workflow-v5；找不到说明路径推断错了");
    }
}
