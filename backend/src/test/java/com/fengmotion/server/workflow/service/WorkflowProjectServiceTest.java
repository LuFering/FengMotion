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

        var state = service.init(projectId, prompt).state();

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
    @DisplayName("重复提交同一需求：不覆盖原文，也不重复记纠正")
    void sameRequirementIsUnchanged() throws Exception {
        String projectId = newProject();
        service.init(projectId, "做一条关于清晨咖啡店的短片");
        var state = service.state(projectId);
        Path corrections = Path.of(state.directory()).resolve("corrections.md");
        String before = Files.readString(corrections);

        var outcome = service.init(projectId, "做一条关于清晨咖啡店的短片");

        assertEquals("UNCHANGED", outcome.result().name());
        assertEquals(before, Files.readString(corrections), "同一需求不该重复追加纠正");
    }

    @Test
    @DisplayName("原文已存在时的不同需求：记为纠正，不覆盖原文")
    void differentRequirementBecomesCorrection() throws Exception {
        String projectId = newProject();
        service.init(projectId, "最初的完整需求，写得很长很清楚。");
        var state = service.state(projectId);
        Path root = Path.of(state.directory());
        Path original = root.resolve("prompt.original.md");
        String originalBefore = Files.readString(original);

        /* 曾经的缺陷：init-project 跳过已存在的原文，新需求既不写入也不记录，
           界面照旧显示「上下文已就绪」—— 用户说的话静默消失了。 */
        var outcome = service.init(projectId, "另外，结尾要出现店名");

        assertEquals("RECORDED_AS_CORRECTION", outcome.result().name());
        assertEquals(originalBefore, Files.readString(original), "原文不能被覆盖");
        String corrections = Files.readString(root.resolve("corrections.md"));
        assertTrue(corrections.contains("另外，结尾要出现店名"),
                "新需求必须落到 corrections.md：" + corrections);
    }

    @Test
    @DisplayName("未初始化时状态如实为 false，不假装已就绪")
    void stateIsFalseBeforeInit() throws Exception {
        String projectId = newProject();

        var state = service.state(projectId);

        assertFalse(state.initialized());
        assertEquals(0, state.renderedPasses());
        assertEquals(0, state.failedPasses());
        assertEquals(0, state.inProgressPasses());
    }

    @Test
    @DisplayName("修改意见追加到 corrections.md，原文不动")
    void recordCorrectionAppends() throws Exception {
        String projectId = newProject();
        var state = service.init(projectId, "做一条咖啡店短片").state();
        Path root = Path.of(state.directory());
        String originalBefore = Files.readString(root.resolve("prompt.original.md"));

        service.recordCorrection(projectId, "结尾要出现店名");

        assertEquals(originalBefore, Files.readString(root.resolve("prompt.original.md")),
                "提修改意见不该动原始需求");
        assertTrue(Files.readString(root.resolve("corrections.md")).contains("结尾要出现店名"));
    }

    @Test
    @DisplayName("没有原文时拒绝记录意见：无主的纠正无法被理解")
    void recordCorrectionRequiresOriginal() throws Exception {
        String projectId = newProject();
        var e = assertThrows(com.fengmotion.server.common.ApiException.class,
                () -> service.recordCorrection(projectId, "改一下"));
        assertEquals("workflow_not_initialized", e.getCode());
    }

    @Test
    @DisplayName("空白意见被拒绝")
    void recordCorrectionRejectsBlank() throws Exception {
        String projectId = newProject();
        service.init(projectId, "需求原文");
        var e = assertThrows(com.fengmotion.server.common.ApiException.class,
                () -> service.recordCorrection(projectId, "  "));
        assertEquals("validation_error", e.getCode());
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
    @DisplayName("渲染轮次按真实产物判定，空目录不算一轮")
    void emptyPassDirIsNotARenderedPass() throws Exception {
        String projectId = newProject();
        var state = service.init(projectId, "需求").state();
        Path passes = Path.of(state.directory()).resolve("qa").resolve("passes");
        Files.createDirectories(passes.resolve("01"));
        Files.createDirectories(passes.resolve("02"));

        var now = service.state(projectId);

        /* 曾经的缺陷：只数目录。空目录也会被算成「已渲染 2 轮」，
           用户以为有两个能看的片子。 */
        assertEquals(0, now.renderedPasses(), "没有视频文件就不算渲染成功");
        assertEquals(2, now.inProgressPasses(), "空目录应算进行中");
    }

    @Test
    @DisplayName("有视频的算成功，有失败记录的算失败，两者分开计数")
    void classifiesPassOutcomes() throws Exception {
        String projectId = newProject();
        var state = service.init(projectId, "需求").state();
        Path passes = Path.of(state.directory()).resolve("qa").resolve("passes");

        // 成功：目录里有 mp4
        Path ok = passes.resolve("01");
        Files.createDirectories(ok);
        Files.writeString(ok.resolve("render.mp4"), "fake");

        // 失败：有 failure.md 但没有视频
        Path bad = passes.resolve("02");
        Files.createDirectories(bad);
        Files.writeString(bad.resolve("failure.md"), "timeout");

        // 进行中：空目录
        Files.createDirectories(passes.resolve("03"));

        var now = service.state(projectId);

        assertEquals(1, now.renderedPasses());
        assertEquals(1, now.failedPasses());
        assertEquals(1, now.inProgressPasses());
    }

    @Test
    @DisplayName("工具目录可被解析到，否则整套流程无从运行")
    void workflowRootIsResolvable() {
        var runner = new WorkflowToolRunner();
        // 开发态布局：backend/ 与 frontend/workflow-v5 同级
        assertTrue(runner.resolveWorkflowRoot() != null,
                "测试环境下应能定位 workflow-v5；找不到说明路径推断错了");
    }
}
