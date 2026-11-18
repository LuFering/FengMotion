package com.fengmotion.server.preset.domain;

import java.util.List;

/**
 * skill 到工作流各位置的映射（格式版本 {@link #VERSION}）。
 *
 * <p>除 {@link #truncatedSources()} 由后端填写外，其余字段都由模型生成、再经
 * {@link com.fengmotion.server.preset.service.PresetMappingValidator} 校验。</p>
 *
 * @param name               视频类型名称
 * @param description        视频类型说明
 * @param slug               英文短标识（小写字母、数字、连字符）
 * @param promptScaffold     创作需求节点的填写骨架
 * @param defaults           默认时长与画幅
 * @param requiredInputs     素材节点的提示
 * @param lookdevTemplate    视觉构想工作稿模板（Markdown）；没有为 null
 * @param filmPlanTemplate   导演处理工作稿模板（Markdown）；没有为 null
 * @param reviewChecklist    审片检查项
 * @param guide              写进 skill-guide.md 的方法指引，每段注明出处
 * @param components         候选组件
 * @param instructedCommands skill 要求运行的命令，每条都要有处理决定
 * @param stepMapping        skill 步骤对应到哪个节点
 * @param unmapped           放不进节点的步骤
 * @param truncatedSources   因上下文预算没有交给模型的文件（后端填写）
 */
public record PresetMapping(String name, String description, String slug, String promptScaffold,
                            Defaults defaults, List<RequiredInput> requiredInputs,
                            String lookdevTemplate, String filmPlanTemplate, List<String> reviewChecklist,
                            List<GuideSection> guide, List<Component> components,
                            List<CommandDecision> instructedCommands, List<StepMapping> stepMapping,
                            List<Unmapped> unmapped, List<String> truncatedSources) {

    /** 映射格式版本。字段只增不改义；改义时升版本。 */
    public static final int VERSION = 1;

    /**
     * @param duration 默认时长描述，例如「8 秒」；没有为 null
     * @param ratio    默认画幅：16:9 / 9:16 / 1:1 / 4:5；没有为 null
     */
    public record Defaults(String duration, String ratio) {
    }

    /**
     * @param kind     asset / reference / text
     * @param label    给用户看的提示
     * @param required 是否必需
     */
    public record RequiredInput(String kind, String label, boolean required) {
    }

    /**
     * @param title   段落标题
     * @param body    段落正文（Markdown）
     * @param sources 出处：skill 包内文件路径，至少一个
     */
    public record GuideSection(String title, String body, List<String> sources) {
    }

    /**
     * @param path    skill 包内路径
     * @param purpose 用途
     */
    public record Component(String path, String purpose) {
    }

    /**
     * @param command  清单里记录的命令原文
     * @param decision replace-with-builtin（用本项目自己的检查替代）/ manual-approval（需人工批准）/ ignore（忽略）
     * @param note     说明
     */
    public record CommandDecision(String command, String decision, String note) {
    }

    /**
     * @param step skill 里的步骤
     * @param node prompt / refs / capability / create / review / delivery / drafts
     * @param note 说明
     */
    public record StepMapping(String step, String node, String note) {
    }

    /**
     * @param step   步骤
     * @param reason 为什么放不进现有节点
     */
    public record Unmapped(String step, String reason) {
    }
}
