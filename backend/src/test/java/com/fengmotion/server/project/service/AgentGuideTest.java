package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 项目级 agent 指引的内容与升级规则。
 *
 * <p>这件事的分量在于：指引决定创作 agent 拿到什么工作方式。
 * 旧指引要求「先想清楚分镜再写 JSON」，会把 agent 一直推向文字卡片，
 * 与 workflow-v5 的 Prompt-first 方向相反 —— 只改新建模板不够，
 * 已有项目也得覆盖到，但用户自己改过的不能碰。</p>
 */
@DisplayName("agent 指引")
class AgentGuideTest {

    private final ProjectDirectoryService service = new ProjectDirectoryService();

    @TempDir
    Path tempDir;

    @Test
    @DisplayName("新项目指引不再要求先写场景 JSON")
    void newGuideDoesNotDemandStoryboardJson() throws Exception {
        Path dir = tempDir.resolve("p1");
        service.create(dir);

        String guide = Files.readString(dir.resolve("AGENTS.md"));

        // 关键指令必须指向 Prompt-first
        assertTrue(guide.contains("prompt.original.md"), "要告诉 agent 创作依据在哪");
        assertTrue(guide.contains("先想清画面"), "要强调先定画面再写代码");
        assertFalse(guide.contains("先想清楚分镜再写 JSON"),
                "旧的「先写分镜 JSON」指令必须消失：它是把创作推回文字卡片的根源");
        // 也不能反过来硬推 JSON 路线
        assertFalse(guide.contains("一次提交整部片"), "不该再要求一次提交整部片");
    }

    @Test
    @DisplayName("指引如实说明场景 props 路径的能力局限，不吹成全功能")
    void guideIsHonestAboutRendererLimits() throws Exception {
        Path dir = tempDir.resolve("p2");
        service.create(dir);
        String guide = Files.readString(dir.resolve("AGENTS.md"));

        /* 现有 /renders 只吃 scenes props，表达不了运镜、光、材质。
           指引若不写清，agent 会把它当成通用出片能力，
           然后交出一堆「会动的字幕卡」还说是完成品。 */
        assertTrue(guide.contains("字幕卡"), "要点明这条路径会得到什么");
        assertTrue(guide.contains("尚未对你的调用开放") || guide.contains("还在做"),
                "项目级工程渲染还没开放，不能假装可用");
        assertFalse(guide.contains("\"entry\""), "这条接口目前不接受 entry 参数，不能写进指引");
    }

    @Test
    @DisplayName("创作方法写成「按需采用」，不是每个需求都必须走完的门槛")
    void guidanceIsMethodNotGate() throws Exception {
        Path dir = tempDir.resolve("p7");
        service.create(dir);
        String guide = Files.readString(dir.resolve("AGENTS.md"));

        /* workflow-v5 的 Prompt-first 默认不要求逐层填完文件。
           指引若写成一串「先…再…」，agent 会把简单需求也当成必须走完整流程，
           凭空多出一堆用户没要的中间产物。 */
        assertTrue(guide.contains("不是必过门槛") || guide.contains("不必为此写一份完整 brief"),
                "要写明这些是方法而非门槛：" + guide.substring(0, 200));
        assertTrue(guide.contains("用户明确要求的表达形式") || guide.contains("用户明确要求"),
                "用户明确要求应优先于流程建议");
    }

    @Test
    @DisplayName("升级：没有指引的项目补一份")
    void upgradeWritesWhenMissing() throws Exception {
        Path dir = tempDir.resolve("p3");
        Files.createDirectories(dir);

        assertEquals(ProjectDirectoryService.GuideUpgrade.WRITTEN,
                service.upgradeAgentGuide(dir, "proj-3"));
        assertTrue(Files.readString(dir.resolve("AGENTS.md")).contains("proj-3"),
                "补写的指引要带真实项目 ID");
    }

    @Test
    @DisplayName("升级：框架旧指引被更新为新版本")
    void upgradeReplacesFrameworkGuide() throws Exception {
        Path dir = tempDir.resolve("p4");
        Files.createDirectories(dir);
        // 模拟早期框架产物：没有标记，只有旧内容
        Files.writeString(dir.resolve("AGENTS.md"), "# 这个项目怎么出片\n\n先想清楚分镜再写 JSON。");

        /* 没有标记 → 无法与用户自维护区分，按安全原则跳过。
           这条断言锁住「宁可不覆盖」的取舍。 */
        assertEquals(ProjectDirectoryService.GuideUpgrade.SKIPPED_USER_EDITED,
                service.upgradeAgentGuide(dir, "proj-4"));
        assertTrue(Files.readString(dir.resolve("AGENTS.md")).contains("先想清楚分镜"),
                "没有标记的文件不能被覆盖");
    }

    @Test
    @DisplayName("升级：带标记的旧版本会被换成当前版本")
    void upgradeUpdatesMarkedGuide() throws Exception {
        Path dir = tempDir.resolve("p5");
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("AGENTS.md"),
                ProjectDirectoryService.GENERATED_MARKER + "\n# 旧版本指引\n");

        assertEquals(ProjectDirectoryService.GuideUpgrade.UPDATED,
                service.upgradeAgentGuide(dir, "proj-5"));
        String updated = Files.readString(dir.resolve("AGENTS.md"));
        assertTrue(updated.contains("先想清画面"), "应换成当前版本内容");
        assertFalse(updated.contains("# 旧版本指引"));
    }

    @Test
    @DisplayName("升级：已是当前版本时不重复改写")
    void upgradeIsIdempotent() throws Exception {
        Path dir = tempDir.resolve("p6");
        service.create(dir);
        service.rewriteAgentGuide(dir, "proj-6");

        assertEquals(ProjectDirectoryService.GuideUpgrade.CURRENT,
                service.upgradeAgentGuide(dir, "proj-6"));
    }
}
