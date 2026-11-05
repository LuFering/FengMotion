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
        /* 项目级 Remotion 工程的渲染后来开放了（后端按 film.config.json 渲染 agent 写的源码），
           所以指引不再说「还在做」，而是告诉 agent 写完源码由后端渲染。
           这里守的是「别让 agent 以为要自己调渲染接口」。 */
        assertTrue(guide.contains("由后端渲染你的工程"),
                "要写明工程由后端渲染，agent 不必自己调接口");
        assertFalse(guide.contains("尚未对你的调用开放"),
                "能力已开放，不能再写未开放");
    }

    @Test
    @DisplayName("旧版本的框架指引会被升级，不当成用户自维护跳过")
    void oldFrameworkGuideIsUpgraded() throws Exception {
        /* 真实故障：升级判定只认当前版本标记，v2 的文件对不上 v3，
           结果 25 个已有项目全被当成「用户改过」跳过，永远拿不到新指引。 */
        Path dir = tempDir.resolve("p-old");
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("AGENTS.md"),
                "<!-- fengmotion:agent-guide:v2 --># 旧版指引\n\n旧内容\n");

        var result = service.upgradeAgentGuide(dir, "p-old");

        assertEquals(ProjectDirectoryService.GuideUpgrade.UPDATED, result,
                "旧版框架指引应当被升级，而不是跳过");
        String guide = Files.readString(dir.resolve("AGENTS.md"));
        /* 不写死具体版本号：一升版本就要改测试，测的其实是「有没有升到当前版本」 */
        assertTrue(guide.startsWith(ProjectDirectoryService.GENERATED_MARKER),
                "升级后应是当前版本：" + guide.substring(0, 60));
        assertTrue(guide.contains("/api/assets"), "升级后应带上三库指引");
    }

    @Test
    @DisplayName("用户自己改过的指引不被覆盖")
    void userEditedGuideIsKept() throws Exception {
        Path dir = tempDir.resolve("p-mine");
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("AGENTS.md"), "# 我自己的创作规范\n\n不要覆盖我。\n");

        var result = service.upgradeAgentGuide(dir, "p-mine");

        assertEquals(ProjectDirectoryService.GuideUpgrade.SKIPPED_USER_EDITED, result);
        assertTrue(Files.readString(dir.resolve("AGENTS.md")).contains("不要覆盖我"));
    }

    @Test
    @DisplayName("指引给出 workflow-v5 工具的真实绝对路径，而不是找不到的相对路径")
    void guideGivesAbsoluteToolchainPath() throws Exception {
        /* 原先只写「工具在 workflow-v5/ 下」，而 agent 的工作目录是项目目录，
           相对路径它根本找不到 —— 那些校验工具从未被调用过。 */
        org.springframework.test.util.ReflectionTestUtils.setField(
                service, "workflowDir", "/opt/fm/resources/workflow-v5");

        Path dir = tempDir.resolve("p-tools");
        service.create(dir);
        String guide = Files.readString(dir.resolve("AGENTS.md"));

        assertTrue(guide.contains("/opt/fm/resources/workflow-v5"),
                "要给出绝对路径，agent 才执行得到");
        assertTrue(guide.contains("validate-shot-plan.mjs"), "要点出主要校验工具");
    }

    @Test
    @DisplayName("指引说明三库在哪、怎么查、什么时候该查")
    void guideExplainsThreeLibraries() throws Exception {
        Path dir = tempDir.resolve("p-libs");
        service.create(dir);
        String guide = Files.readString(dir.resolve("AGENTS.md"));

        /* 库里有什么，agent 原先完全不知道：AGENTS.md 一个字没提三库，
           只有用户手动选了资源、由 resources-in-use.md 带路径时才用得上。
           用户说「找个合适的素材」时它不会去翻库。 */
        assertTrue(guide.contains("/api/assets"), "素材库接口");
        assertTrue(guide.contains("/api/reference-videos"), "参考片库接口");
        assertTrue(guide.contains("/api/fx-techniques"), "特效库接口");
        assertTrue(guide.contains("resources-in-use.md"), "用户已点名资源时的依据文件");
        assertTrue(guide.contains("不要自行更改用途"), "用途不能被 agent 改");
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
