package com.fengmotion.server.fx.api.dto;

import java.util.List;

/**
 * 技法响应（契约 library.md §2.1）。
 *
 * <p>关键字段 {@code executionStatus}：它回答「这台机器现在能不能跑」。
 * {@code execType} 只是源库声明的标签，**界面不得据此显示「可执行」**。</p>
 */
public record FxTechniqueResponse(
        String id,
        String name,
        String nameEn,
        List<String> aliases,
        List<String> keywords,
        String intent,
        String category,
        String categoryLabel,
        List<String> scenes,
        List<String> antiScenes,
        String execType,
        String execLabel,
        String executionStatus,
        String impl,
        String implLabel,
        int complexity,
        List<String> inputKinds,
        List<String> inputLabels,
        String inputRequirement,
        String output,
        List<String> dependencies,
        List<String> steps,
        List<String> compatibility,
        List<String> limitations,
        List<String> failures,
        List<ParamResponse> params,
        String previewImageUrl,
        String previewVideoUrl,
        String previewCaption,
        List<String> related,
        List<String> alternatives,
        boolean featured,
        String version,
        String updatedAt,
        boolean demo,
        /** 来源：builtin / lemo / shotcraft / scene。界面据此区分「自带」与「外部导入」。 */
        String sourceKind,
        String sourceProject,
        String sourceUrl,
        String sourceVersion,
        String licenseCode,
        String licensePreview,
        String attribution,
        String sourcePath,
        String importedAt,
        UserStateResponse userState) {

    /** 参数。 */
    public record ParamResponse(String key, String label, String value, String hint) {
    }

    /**
     * 用户状态。
     *
     * @param favorited    是否收藏
     * @param lastViewedAt 最近浏览时间；从未浏览为 null
     */
    public record UserStateResponse(boolean favorited, String lastViewedAt) {
    }
}
