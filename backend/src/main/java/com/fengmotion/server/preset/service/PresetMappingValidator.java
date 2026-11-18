package com.fengmotion.server.preset.service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.fengmotion.server.preset.domain.PresetMapping;
import com.fengmotion.server.skill.domain.SkillInventory;

/**
 * 逐项校验预设映射。
 *
 * <p>「模型说了算」和「校验说了算」的分界落在这里：模型可能编造文件、漏掉要求运行的命令，
 * 或者把命令标成可以自动运行。这些都必须被拦下，而不是写进项目让 agent 照做。
 * 校验拦不住「写得不好」，所以映射还要经过人工审阅才能启用。</p>
 */
public final class PresetMappingValidator {

    static final Set<String> NODES = Set.of("prompt", "refs", "capability", "create", "review", "delivery", "drafts");
    static final Set<String> DECISIONS = Set.of("replace-with-builtin", "manual-approval", "ignore");
    static final Set<String> INPUT_KINDS = Set.of("asset", "reference", "text");
    static final Set<String> RATIOS = Set.of("16:9", "9:16", "1:1", "4:5");
    static final int MAX_GUIDE_CHARS = 40_000;

    private PresetMappingValidator() {
    }

    /**
     * @param field   出问题的字段路径，例如 {@code guide[2].sources[0]}
     * @param message 原因
     */
    public record Problem(String field, String message) {
    }

    /**
     * 校验映射。
     *
     * @param mapping   映射
     * @param inventory 来源 skill 包的清单
     * @param skillPath 来源 SKILL.md 的包内路径
     * @return 问题列表；为空表示通过
     */
    public static List<Problem> validate(PresetMapping mapping, SkillInventory inventory, String skillPath) {
        List<Problem> problems = new ArrayList<>();
        if (mapping == null) {
            problems.add(new Problem("", "映射为空"));
            return problems;
        }
        Map<String, String> categories = new HashMap<>();
        for (var file : inventory.files()) categories.put(file.path(), file.category());

        text(problems, "name", mapping.name(), 1, 40);
        text(problems, "description", mapping.description(), 1, 300);
        if (mapping.slug() == null || !mapping.slug().matches("[a-z0-9]+(-[a-z0-9]+)*") || mapping.slug().length() > 40) {
            problems.add(new Problem("slug", "只能用小写字母、数字和连字符，最长 40 个字符"));
        }
        text(problems, "promptScaffold", mapping.promptScaffold(), 1, 4000);
        if (mapping.defaults() != null) {
            optionalText(problems, "defaults.duration", mapping.defaults().duration(), 40);
            if (mapping.defaults().ratio() != null && !RATIOS.contains(mapping.defaults().ratio())) {
                problems.add(new Problem("defaults.ratio", "画幅只能是 " + RATIOS));
            }
        }

        List<PresetMapping.RequiredInput> inputs = orEmpty(mapping.requiredInputs());
        if (inputs.size() > 10) problems.add(new Problem("requiredInputs", "最多 10 项"));
        for (int i = 0; i < inputs.size(); i++) {
            var input = inputs.get(i);
            if (input == null || !INPUT_KINDS.contains(input.kind())) {
                problems.add(new Problem("requiredInputs[" + i + "].kind", "只能是 " + INPUT_KINDS));
            }
            if (input != null) text(problems, "requiredInputs[" + i + "].label", input.label(), 1, 100);
        }

        optionalText(problems, "lookdevTemplate", mapping.lookdevTemplate(), 20_000);
        optionalText(problems, "filmPlanTemplate", mapping.filmPlanTemplate(), 20_000);

        List<String> checklist = orEmpty(mapping.reviewChecklist());
        if (checklist.isEmpty() || checklist.size() > 20) problems.add(new Problem("reviewChecklist", "需要 1 到 20 项"));
        for (int i = 0; i < checklist.size(); i++) text(problems, "reviewChecklist[" + i + "]", checklist.get(i), 1, 200);

        List<PresetMapping.GuideSection> guide = orEmpty(mapping.guide());
        if (guide.isEmpty() || guide.size() > 30) problems.add(new Problem("guide", "需要 1 到 30 段"));
        int guideChars = 0;
        for (int i = 0; i < guide.size(); i++) {
            var section = guide.get(i);
            String field = "guide[" + i + "]";
            if (section == null) {
                problems.add(new Problem(field, "段落为空"));
                continue;
            }
            text(problems, field + ".title", section.title(), 1, 80);
            text(problems, field + ".body", section.body(), 1, 8000);
            guideChars += length(section.title()) + length(section.body());
            List<String> sources = orEmpty(section.sources());
            if (sources.isEmpty()) problems.add(new Problem(field + ".sources", "每段至少注明一个出处文件"));
            for (int j = 0; j < sources.size(); j++) {
                if (!categories.containsKey(sources.get(j))) {
                    problems.add(new Problem(field + ".sources[" + j + "]", "清单里没有这个文件：" + sources.get(j)));
                }
            }
        }
        if (guideChars > MAX_GUIDE_CHARS) problems.add(new Problem("guide", "指引总量超过 " + MAX_GUIDE_CHARS + " 个字符"));

        List<PresetMapping.Component> components = orEmpty(mapping.components());
        if (components.size() > 30) problems.add(new Problem("components", "最多 30 个"));
        Set<String> seenComponents = new HashSet<>();
        for (int i = 0; i < components.size(); i++) {
            var component = components.get(i);
            String field = "components[" + i + "]";
            if (component == null) {
                problems.add(new Problem(field, "组件为空"));
                continue;
            }
            String category = categories.get(component.path());
            if (category == null) {
                problems.add(new Problem(field + ".path", "清单里没有这个文件：" + component.path()));
            } else if (!category.equals("component") && !category.equals("code")) {
                problems.add(new Problem(field + ".path", "不是组件或代码文件（类别 " + category + "）：" + component.path()));
            }
            if (!seenComponents.add(String.valueOf(component.path()))) problems.add(new Problem(field + ".path", "重复的组件"));
            text(problems, field + ".purpose", component.purpose(), 1, 200);
        }

        /* 命令必须和清单一一对应：漏掉的命令会让 agent 不知道该不该跑，编造的命令没有出处。 */
        Set<String> expected = new HashSet<>();
        for (var command : inventory.instructedCommands()) {
            if (command.skillPath().equals(skillPath)) expected.add(command.command());
        }
        List<PresetMapping.CommandDecision> decisions = orEmpty(mapping.instructedCommands());
        Set<String> decided = new HashSet<>();
        for (int i = 0; i < decisions.size(); i++) {
            var decision = decisions.get(i);
            String field = "instructedCommands[" + i + "]";
            if (decision == null) {
                problems.add(new Problem(field, "决定为空"));
                continue;
            }
            if (!expected.contains(decision.command())) {
                problems.add(new Problem(field + ".command", "清单里没有这条命令：" + decision.command()));
            } else if (!decided.add(decision.command())) {
                problems.add(new Problem(field + ".command", "同一条命令只能有一个决定"));
            }
            if (!DECISIONS.contains(decision.decision())) {
                problems.add(new Problem(field + ".decision", "只能是 " + DECISIONS + "，不允许自动运行"));
            }
            optionalText(problems, field + ".note", decision.note(), 300);
        }
        for (String missing : expected) {
            if (!decided.contains(missing)) problems.add(new Problem("instructedCommands", "缺少这条命令的处理决定：" + missing));
        }

        List<PresetMapping.StepMapping> steps = orEmpty(mapping.stepMapping());
        if (steps.isEmpty() || steps.size() > 40) problems.add(new Problem("stepMapping", "需要 1 到 40 项"));
        for (int i = 0; i < steps.size(); i++) {
            var step = steps.get(i);
            String field = "stepMapping[" + i + "]";
            if (step == null) {
                problems.add(new Problem(field, "步骤为空"));
                continue;
            }
            text(problems, field + ".step", step.step(), 1, 200);
            if (!NODES.contains(step.node())) problems.add(new Problem(field + ".node", "只能是 " + NODES));
            optionalText(problems, field + ".note", step.note(), 300);
        }

        List<PresetMapping.Unmapped> unmapped = orEmpty(mapping.unmapped());
        if (unmapped.size() > 30) problems.add(new Problem("unmapped", "最多 30 项"));
        for (int i = 0; i < unmapped.size(); i++) {
            var item = unmapped.get(i);
            if (item == null) {
                problems.add(new Problem("unmapped[" + i + "]", "条目为空"));
                continue;
            }
            text(problems, "unmapped[" + i + "].step", item.step(), 1, 200);
            text(problems, "unmapped[" + i + "].reason", item.reason(), 1, 300);
        }
        return problems;
    }

    private static void text(List<Problem> problems, String field, String value, int min, int max) {
        int length = value == null ? 0 : value.strip().length();
        if (length < min) problems.add(new Problem(field, "不能为空"));
        else if (value.length() > max) problems.add(new Problem(field, "超过 " + max + " 个字符"));
    }

    private static void optionalText(List<Problem> problems, String field, String value, int max) {
        if (value != null && value.length() > max) problems.add(new Problem(field, "超过 " + max + " 个字符"));
    }

    private static int length(String value) {
        return value == null ? 0 : value.length();
    }

    private static <T> List<T> orEmpty(List<T> list) {
        return list == null ? List.of() : list;
    }
}
