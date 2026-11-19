package com.fengmotion.server.preset.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.fengmotion.server.preset.domain.PresetMapping;
import com.fengmotion.server.preset.domain.PresetMapping.CommandDecision;
import com.fengmotion.server.preset.domain.PresetMapping.Component;
import com.fengmotion.server.preset.domain.PresetMapping.GuideSection;
import com.fengmotion.server.preset.domain.PresetMapping.StepMapping;
import com.fengmotion.server.skill.domain.SkillInventory;

/** 校验要拦住：编造文件、漏掉或编造命令、允许自动运行、格式越界。 */
class PresetMappingValidatorTest {

    static final String SKILL = "skills/logo/SKILL.md";

    static SkillInventory inventory() {
        return new SkillInventory(1,
                List.of(new SkillInventory.Skill(SKILL, "skills/logo", "logo", "d", Map.of(), null)),
                List.of(new SkillInventory.FileEntry(SKILL, 10, "x", "skill", null),
                        new SkillInventory.FileEntry("skills/logo/README.md", 10, "x", "doc", null),
                        new SkillInventory.FileEntry("skills/logo/src/Logo.tsx", 10, "x", "component", List.of())),
                List.of(),
                List.of(new SkillInventory.InstructedCommand(SKILL, "bash scripts/check.sh"),
                        new SkillInventory.InstructedCommand("other/SKILL.md", "npm run other")),
                new SkillInventory.Dependencies(Map.of(), List.of(), List.of(), Map.of(), true),
                new SkillInventory.License("MIT", List.of(), null), List.of(),
                new SkillInventory.Summary(1, 3, 30, Map.of(), 0, 0));
    }

    static PresetMapping valid() {
        return new PresetMapping("Logo 动画", "品牌 Logo 的入场动效", "logo-animation", "品牌名：\nLogo 文件：",
                new PresetMapping.Defaults("8 秒", "16:9"),
                List.of(new PresetMapping.RequiredInput("asset", "品牌 Logo（SVG 优先）", true)),
                "# 视觉构想", null, List.of("Logo 最终帧是否清晰"),
                List.of(new GuideSection("路径描绘", "先描边再填色", List.of(SKILL))),
                List.of(new Component("skills/logo/src/Logo.tsx", "SVG 分路径动画")),
                List.of(new CommandDecision("bash scripts/check.sh", "replace-with-builtin", "用本项目渲染检查")),
                List.of(new StepMapping("检查已渲染的关键帧", "review", null, "inspect")), List.of(), List.of());
    }

    private static List<String> fields(PresetMapping m) {
        return PresetMappingValidator.validate(m, inventory(), SKILL).stream().map(PresetMappingValidator.Problem::field).toList();
    }

    private static PresetMapping with(PresetMapping m, List<GuideSection> guide, List<Component> components,
                                      List<CommandDecision> commands) {
        return new PresetMapping(m.name(), m.description(), m.slug(), m.promptScaffold(), m.defaults(), m.requiredInputs(),
                m.lookdevTemplate(), m.filmPlanTemplate(), m.reviewChecklist(), guide, components, commands,
                m.stepMapping(), m.unmapped(), m.truncatedSources());
    }

    @Test
    @DisplayName("合格的映射没有问题")
    void validMappingPasses() {
        assertEquals(List.of(), PresetMappingValidator.validate(valid(), inventory(), SKILL));
    }

    @Test
    @DisplayName("出处和组件只能用清单里的文件；文档不能当组件")
    void rejectsFabricatedPaths() {
        var m = valid();
        assertTrue(fields(with(m, List.of(new GuideSection("t", "b", List.of("skills/logo/made-up.md"))), m.components(),
                m.instructedCommands())).contains("guide[0].sources[0]"));
        assertTrue(fields(with(m, List.of(new GuideSection("t", "b", List.of())), m.components(),
                m.instructedCommands())).contains("guide[0].sources"), "每段都要有出处");
        assertTrue(fields(with(m, m.guide(), List.of(new Component("src/Ghost.tsx", "x")), m.instructedCommands()))
                .contains("components[0].path"));
        assertTrue(fields(with(m, m.guide(), List.of(new Component("skills/logo/README.md", "x")), m.instructedCommands()))
                .contains("components[0].path"));
    }

    @Test
    @DisplayName("命令要与清单一一对应，且不允许自动运行")
    void commandsMustMatchInventory() {
        var m = valid();
        assertTrue(fields(with(m, m.guide(), m.components(), List.of())).contains("instructedCommands"), "漏掉命令");
        assertTrue(fields(with(m, m.guide(), m.components(), List.of(
                new CommandDecision("bash scripts/check.sh", "replace-with-builtin", null),
                new CommandDecision("rm -rf /", "ignore", null)))).contains("instructedCommands[1].command"), "编造命令");
        assertTrue(fields(with(m, m.guide(), m.components(), List.of(
                new CommandDecision("bash scripts/check.sh", "auto-run", null)))).contains("instructedCommands[0].decision"));
        assertTrue(fields(with(m, m.guide(), m.components(), List.of(
                new CommandDecision("bash scripts/check.sh", "ignore", null),
                new CommandDecision("bash scripts/check.sh", "ignore", null)))).contains("instructedCommands[1].command"), "重复决定");
        assertTrue(fields(with(m, m.guide(), m.components(), List.of(
                new CommandDecision("bash scripts/check.sh", "ignore", null),
                new CommandDecision("npm run other", "ignore", null)))).contains("instructedCommands[1].command"),
                "其他 skill 的命令不属于这个映射");
    }

    @Test
    @DisplayName("格式越界：slug、画幅、检查项、节点、指引总量")
    void rejectsOutOfRange() {
        var m = valid();
        var bad = new PresetMapping("", m.description(), "Logo Animation", m.promptScaffold(),
                new PresetMapping.Defaults("8 秒", "21:9"), List.of(new PresetMapping.RequiredInput("file", "x", true)),
                null, null, List.of(), List.of(new GuideSection("t", "x".repeat(8001), List.of(SKILL))),
                m.components(), m.instructedCommands(), List.of(new StepMapping("s", "storyboard", null)), null, null);
        var f = fields(bad);
        for (String expected : List.of("name", "slug", "defaults.ratio", "requiredInputs[0].kind", "reviewChecklist",
                "guide[0].body", "stepMapping[0].node")) {
            assertTrue(f.contains(expected), expected + " 应被拦下：" + f);
        }

        var sections = new java.util.ArrayList<GuideSection>();
        for (int i = 0; i < 6; i++) sections.add(new GuideSection("t" + i, "x".repeat(7000), List.of(SKILL)));
        assertTrue(fields(with(m, sections, m.components(), m.instructedCommands())).contains("guide"), "指引总量超限");
    }
}
