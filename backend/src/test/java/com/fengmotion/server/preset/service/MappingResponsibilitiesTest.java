package com.fengmotion.server.preset.service;

import com.fengmotion.server.preset.domain.PresetMapping;
import com.fengmotion.server.preset.domain.PresetMapping.RequiredInput;
import com.fengmotion.server.preset.domain.PresetMapping.StepMapping;
import com.fengmotion.server.skill.domain.SkillInventory.FileEntry;
import com.fengmotion.server.skill.domain.SkillInventory.ImportRef;
import com.fengmotion.server.skill.service.SkillReferences;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class MappingResponsibilitiesTest {
    private static List<String> issues(String text, String node, String action, int version) {
        var problems = new ArrayList<PresetMappingValidator.Problem>();
        MappingResponsibilities.checkStep(new StepMapping(text, node, null, action), "stepMapping[0]", version, problems);
        return problems.stream().map(PresetMappingValidator.Problem::field).toList();
    }

    @Test void renderIsNotDeliveryEvenWhenTheLabelClaimsOtherwise() {
        assertTrue(issues("生成交付版本", "delivery", "render", 2).contains("stepMapping[0].node"));
        assertTrue(issues("渲染成片 mp4 交付", "delivery", "deliver-approved", 2).contains("stepMapping[0].step"));
        assertTrue(issues("安装场景组件", "capability", null, 1).contains("stepMapping[0].step"));
        assertTrue(issues("检查已渲染成片", "review", "inspect", 2).isEmpty());
        assertTrue(issues("交付审片通过的渲染结果", "delivery", "deliver-approved", 2).isEmpty());
    }

    @Test void newActionsAreRequiredButOldReferenceOnlySkillsCanStillBeReviewed() {
        assertTrue(issues("查证术语出处", "review", null, 2).contains("stepMapping[0].action"));
        assertTrue(issues("查证术语出处", "review", "invented", 2).contains("stepMapping[0].action"));
        assertTrue(issues("查证术语出处", "review", null, 1).isEmpty());
        assertTrue(issues("核对字幕拼写", "review", "inspect", 2).isEmpty());
        assertTrue(issues("收集数表", "refs", "collect-input", 2).isEmpty());
        assertTrue(issues("构建排名图", "create", "compose", 2).isEmpty());
    }

    private static List<String> inputIssues(String description, RequiredInput input, String check) {
        var base = PresetMappingValidatorTest.valid();
        var mapping = new PresetMapping(base.name(), description, base.slug(), base.promptScaffold(), base.defaults(), List.of(input),
                null, null, List.of(check), base.guide(), base.components(), base.instructedCommands(), base.stepMapping(), List.of(), List.of());
        return PresetMappingValidator.validate(mapping, PresetMappingValidatorTest.inventory(), PresetMappingValidatorTest.SKILL)
                .stream().map(PresetMappingValidator.Problem::field).toList();
    }

    @Test void conditionalAssetsAreNotGloballyRequiredAndCanBeUnrelatedToLogos() {
        assertTrue(inputIssues("数据可视化", new RequiredInput("asset", "头像", true, "人物排行模式"), "图例是否清晰").contains("requiredInputs[0].required"));
        assertTrue(inputIssues("数据可视化", new RequiredInput("asset", "头像", false, "人物排行模式"), "图例是否清晰").isEmpty());
        assertTrue(inputIssues("没有图片时只需要文字", new RequiredInput("asset", "品牌 Logo", true), "标志是否清晰").contains("requiredInputs[0].required"));
        assertTrue(inputIssues("所有场景都用标记", new RequiredInput("asset", "品牌 Logo", true), "标志是否清晰").isEmpty());
    }

    @Test void visibilityChecksDoNotConfusePlannedTransitionsWithUnreadableText() {
        assertTrue(MappingResponsibilities.asksForLostContrast("浅色背景上的白色 Logo 是否已消失（改用深色背景）？"));
        assertFalse(MappingResponsibilities.asksForLostContrast("白色 Logo 在浅色背景上是否始终清晰可见？"));
        assertFalse(MappingResponsibilities.asksForLostContrast("浅色背景上的过渡遮罩是否已消失？"));
    }

    @Test void registryIndexModulesAreValidButAnApplicationBootstrapIsNot() {
        var boot = List.of(new ImportRef("./Root", "relative", "src/Root.tsx"), new ImportRef("../app/globals.css", "relative", "app/globals.css"));
        assertFalse(SkillReferences.isComponentCandidate(new FileEntry("src/remotion/index.ts", 10, "sum", "code", boot)));
        assertTrue(SkillReferences.isComponentCandidate(new FileEntry("registry/chart/index.tsx", 10, "sum", "component", List.of(new ImportRef("./colors", "relative", "registry/chart/colors.ts")))));
    }
}
