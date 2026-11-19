package com.fengmotion.server.preset.service;

import com.fengmotion.server.preset.domain.PresetMapping;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

enum MappingResponsibilities {
    BRIEF("define-intent", "prompt", "明确目标、限制和输出要求"),
    INPUT("collect-input", "refs", "收集并关联输入或参考，不假设文件已挂载"),
    TECHNIQUE("select-technique", "capability", "选择已有技法，不安装依赖、不执行命令"),
    PLAN("write-draft", "drafts", "编写视觉构想、分镜或导演工作稿"),
    MAKE("compose", "create", "编写、编排或修改作品，使用已有资产与已提供的参考源码"),
    RENDER("render", "create", "制作预览、渲染静帧或视频成片"),
    CHECK("inspect", "review", "检查已有预览、记录修改意见或批准，不渲染"),
    DELIVER("deliver-approved", "delivery", "交付已通过审片的最新成片，不制作、不重新渲染");

    final String action;
    final String node;
    final String description;
    MappingResponsibilities(String action, String node, String description) {
        this.action = action;
        this.node = node;
        this.description = description;
    }

    static final Set<String> NODES = Arrays.stream(values()).map(rule -> rule.node).collect(Collectors.toUnmodifiableSet());
    private static final Pattern INSTALL = Pattern.compile("^(?:安装|下载安装|自动安装|执行安装|install\\b|npm\\s+(?:i|install)\\b|pnpm\\s+add\\b|npx\\s+shadcn(?:@[^ ]+)?\\s+add\\b)", Pattern.CASE_INSENSITIVE);
    private static final Pattern PRODUCE = Pattern.compile("^(?:(?:重新|开始|执行|最终)?渲染\\s*(?:最终|完整|成片|视频|动画|预览|输出|静帧|关键帧|样片|mp4|still)|(?:re-?render|render|encode)\\s+(?:(?:the|a|an|final|approved|preview)\\s+)*(?:video|movie|animation|mp4|film|still|frames?|clip)\\b)", Pattern.CASE_INSENSITIVE);
    private static final Pattern TEXT_ONLY = Pattern.compile("(?:纯文字(?:方案|场景|模式|分支)|没有(?:图片|照片)|无(?:图片|照片)|text-only (?:mode|scene|variant)|no (?:images|photos))[^。\\n]{0,140}(?:只需(?:要)?(?:文字|文本|品牌名)|仅需(?:文字|文本|品牌名)|only (?:the )?(?:text|name))", Pattern.CASE_INSENSITIVE);
    private static final Pattern VISUAL_ASSET = Pattern.compile("logo|标志|品牌标识|图片|照片|image|photo", Pattern.CASE_INSENSITIVE);
    private static final String BACKGROUND = "(?:浅色背景|浅底|白底|深色背景|深底|黑底)";
    private static final String SUBJECT = "(?:logo|字标|字幕|文字|标识|标志)";
    private static final Pattern LOST_CONTRAST = Pattern.compile("(?:" + BACKGROUND + "(?:上|中|里)?的?(?:白色|深色|浅色|黑色|反白)?\\s*" + SUBJECT
            + "|" + SUBJECT + "\\s*在" + BACKGROUND + "(?:上|中|里)?)\\s*是否(?:已经|已|会)?(?:消失|不可见|看不清|无法辨认)", Pattern.CASE_INSENSITIVE);

    static String contract() {
        return Arrays.stream(values()).map(rule -> rule.action + " → " + rule.node + "：" + rule.description).collect(Collectors.joining("\n"));
    }

    static void checkStep(PresetMapping.StepMapping step, String field, int version, List<PresetMappingValidator.Problem> problems) {
        String action = step.action();
        if (action != null || version >= 2) {
            var rule = Arrays.stream(values()).filter(candidate -> candidate.action.equals(action)).findFirst();
            if (rule.isEmpty()) problems.add(new PresetMappingValidator.Problem(field + ".action", "请选择映射约定中的动作类型；无法归类的步骤放入 unmapped"));
            else if (!rule.get().node.equals(step.node())) problems.add(new PresetMappingValidator.Problem(field + ".node", action + " 应属于 " + rule.get().node + "：" + rule.get().description));
        }
        for (String instruction : new String[]{step.step(), step.note()}) {
            if (instruction == null) continue;
            String text = instruction.stripLeading();
            if (INSTALL.matcher(text).find()) {
                problems.add(new PresetMappingValidator.Problem(field + ".step", "工作流节点不安装软件；把原命令和处理决定留在 instructedCommands，仅映射实际可做的动作"));
                break;
            }
            if (!RENDER.node.equals(step.node()) && PRODUCE.matcher(text).find()) {
                problems.add(new PresetMappingValidator.Problem(field + ".step", "实际渲染属于 create；检查已有渲染属于 review，交付已通过的成片属于 delivery"));
                break;
            }
        }
    }

    static boolean describesTextOnlyOption(PresetMapping mapping) {
        return matchesTextOnly(mapping.description()) || matchesTextOnly(mapping.promptScaffold()) || (mapping.guide() != null && mapping.guide().stream()
                .anyMatch(section -> section != null && matchesTextOnly(section.body())));
    }

    private static boolean matchesTextOnly(String text) { return text != null && TEXT_ONLY.matcher(text).find(); }
    static boolean isVisualAsset(String label) { return label != null && VISUAL_ASSET.matcher(label).find(); }
    static boolean asksForLostContrast(String text) { return text != null && LOST_CONTRAST.matcher(text).find(); }
}
