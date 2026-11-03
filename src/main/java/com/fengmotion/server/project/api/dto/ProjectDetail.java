package com.fengmotion.server.project.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 项目详情及列表条目的响应数据。
 *
 * @param id 项目的稳定标识
 * @param name 项目名称
 * @param tagline 项目的一句话简介，可为空字符串
 * @param stage 项目阶段：idea、draft、editing、rendering 或 done
 * @param genomeId 片型画像标识；未选择片型时为 null
 * @param durationMs 当前成片时长，单位为毫秒；当前尚未接入时间线，返回初始值 0
 * @param targetDurationMs 目标时长，单位为毫秒；未设置时不出现在 JSON 中
 * @param counts 项目内容统计；当前尚未接入真实统计，返回初始值
 * @param coverUrl 封面地址；没有封面时为 null
 * @param rootPath 项目根目录的绝对路径
 * @param createdAt 创建时间，ISO 8601 格式
 * @param updatedAt 最近更新时间，ISO 8601 格式
 * @param etag 更新凭证，修改项目前需通过 If-Match 传回
 * @param settings 画布和项目目标设置
 */
public record ProjectDetail(
        String id,
        String name,
        String tagline,
        String stage,
        String genomeId,
        long durationMs,
        @JsonInclude(JsonInclude.Include.NON_NULL) Long targetDurationMs,
        Counts counts,
        String coverUrl,
        String rootPath,
        String createdAt,
        String updatedAt,
        String etag,
        Settings settings
) {
    /**
     * 项目内容统计；这些字段目前均返回初始值 0，等待相应模块接入。
     *
     * @param scenes 场景数量
     * @param doneScenes 已定稿的场景数量
     * @param storyboardSegments 分镜规划段数
     * @param compositions 已生成的合成文件数量
     * @param timelineClips 成片时间线中的片段数量
     */
    public record Counts(
            int scenes,
            int doneScenes,
            int storyboardSegments,
            int compositions,
            int timelineClips
    ) {}

    /**
     * 项目画布和目标设置。画布尺寸、帧率目前使用固定初始值。
     *
     * @param width 画布宽度，单位为像素；当前初始值为 1920
     * @param height 画布高度，单位为像素；当前初始值为 1080
     * @param fps 画布帧率，单位为帧/秒；当前初始值为 30
     * @param targetDurationMs 目标时长，单位为毫秒；未设置时当前返回 0，语义仍待统一
     * @param genomeId 片型画像标识；未选择片型时为 null
     */
    public record Settings(
            int width,
            int height,
            int fps,
            long targetDurationMs,
            String genomeId
    ) {}
}
