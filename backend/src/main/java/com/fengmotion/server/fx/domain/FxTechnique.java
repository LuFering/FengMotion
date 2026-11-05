package com.fengmotion.server.fx.domain;

import java.time.Instant;
import java.util.List;

/**
 * 特效技法（契约 library.md §2.1）。
 *
 * <p>字段顺序与契约表格一致，便于逐项核对。列表字段都用 {@code List} 而非可空，
 * 空列表表示「没有」，null 表示「没读到」—— 两者在界面上含义不同，
 * 混用会让「没有限制」和「限制未知」看起来一样。</p>
 *
 * @param id               稳定 ID
 * @param name             中文名
 * @param nameEn           英文名
 * @param aliases          别名
 * @param keywords         检索词
 * @param intent           解决什么表达问题
 * @param category         按效果用途分类
 * @param categoryLabel    分类展示名
 * @param scenes           适用场景
 * @param antiScenes       不适用场景
 * @param execType         源库声明的执行类型（只是标签）
 * @param execLabel        执行类型展示名
 * @param executionStatus  本机真实可执行状态
 * @param impl             实现方式
 * @param implLabel        实现方式展示名
 * @param complexity       复杂度 1–5
 * @param inputKinds       需要的输入类型
 * @param inputLabels      输入类型展示名
 * @param inputRequirement 输入要求
 * @param output           输出形态
 * @param dependencies     依赖
 * @param steps            操作步骤
 * @param compatibility    兼容性
 * @param limitations      限制
 * @param failures         常见失败
 * @param params           参数与默认值
 * @param previewImageUrl  预览图
 * @param previewVideoUrl  预览视频
 * @param previewCaption   预览说明
 * @param related          相关技法 ID
 * @param alternatives     替代技法 ID
 * @param featured         是否精选
 * @param version          版本
 * @param updatedAt        更新时间
 * @param demo             演示数据标记
 */
public record FxTechnique(
        String id,
        String name,
        String nameEn,
        List<String> aliases,
        List<String> keywords,
        String intent,
        FxStates.Category category,
        String categoryLabel,
        List<String> scenes,
        List<String> antiScenes,
        FxStates.ExecType execType,
        String execLabel,
        FxStates.ExecutionStatus executionStatus,
        FxStates.Impl impl,
        String implLabel,
        int complexity,
        List<FxStates.InputKind> inputKinds,
        List<String> inputLabels,
        String inputRequirement,
        String output,
        List<String> dependencies,
        List<String> steps,
        List<String> compatibility,
        List<String> limitations,
        List<String> failures,
        List<FxParam> params,
        String previewImageUrl,
        String previewVideoUrl,
        String previewCaption,
        List<String> related,
        List<String> alternatives,
        boolean featured,
        String version,
        Instant updatedAt,
        boolean demo,
        /* ── 来源与许可 ──
           从外部仓库导入的条目必须能回答「这是谁的、从哪来的、能不能商用、会不会过期」。
           这四个问题缺一个，用户就不敢用 —— 这正是这类素材库最常见的信任缺口。 */

        /** 来源类型：builtin（本项目自带）/ lemo / shotcraft / scene。 */
        String sourceKind,
        /** 来源项目名，例如 lemo-opuscar。 */
        String sourceProject,
        /** 原始链接（仓库或条目页）。 */
        String sourceUrl,
        /** 版本或 commit；不知道时为空串，不编「latest」。 */
        String sourceVersion,
        /** 代码与文档的许可，例如 MIT。 */
        String licenseCode,
        /** 预览素材的许可，例如 CC BY 4.0。与代码许可分开：两者常不同。 */
        String licensePreview,
        /** 署名要求原文。 */
        String attribution,
        /** 本地源码位置；没有为空串。 */
        String sourcePath,
        /** 导入时间；内置条目为 null。 */
        Instant importedAt) {

    /** 是否是外部导入的条目（而非本项目自带）。 */
    public boolean external() {
        return sourceKind != null && !sourceKind.isBlank() && !"builtin".equals(sourceKind);
    }
}
