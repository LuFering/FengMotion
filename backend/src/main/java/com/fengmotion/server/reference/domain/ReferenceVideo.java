package com.fengmotion.server.reference.domain;

import java.time.Instant;
import java.util.List;

/**
 * 参考片（契约 library.md §4.1）。
 *
 * <p>{@code assetId} 指向素材库里的真实文件 —— <strong>同一个视频不存两份</strong>。
 * 素材负责「文件在哪、多大、能不能播」，参考片负责「这段视频里有什么值得借鉴」。
 * 没有 assetId 的参考片是演示数据或纯外部链接，此时不能声称文件可播放。</p>
 *
 * @param id           稳定 ID
 * @param title        标题
 * @param durationMs   时长
 * @param source       来源（URL / 文件名 / 出处）
 * @param description  描述
 * @param tags         标签
 * @param assetId      关联的素材 ID；有值才表示本机有可播放的文件
 * @param thumbnailUrl 封面
 * @param status       视频级解析状态
 * @param createdAt    导入时间
 * @param updatedAt    更新时间
 * @param demo         演示数据标记
 */
public record ReferenceVideo(
        String id,
        String title,
        long durationMs,
        String source,
        String description,
        List<String> tags,
        String assetId,
        String thumbnailUrl,
        ReferenceStates.Status status,
        Instant createdAt,
        Instant updatedAt,
        boolean demo) {

    /** 本机是否有可播放的文件。界面据此决定显示播放器还是「仅静帧」。 */
    public boolean playable() {
        return assetId != null && !assetId.isBlank();
    }
}
