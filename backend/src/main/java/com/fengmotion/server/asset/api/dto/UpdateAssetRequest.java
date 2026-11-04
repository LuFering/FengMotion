package com.fengmotion.server.asset.api.dto;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fengmotion.server.asset.domain.AssetStates;

/**
 * 素材更新请求（契约 asset.md §3.4 PATCH）。
 *
 * <p>所有字段可空 = 「不改这一项」。这让「只改标签」不必回传整个对象，
 * 也就不会因为前端持有的旧值而把别的字段冲掉。</p>
 *
 * <p><strong>folderId 用三态而不是 String</strong>：{@code null} 表示「不改」，
 * 空串表示「移回根目录」，非空表示「移到该文件夹」。若只用可空 String，
 * 「移回根目录」就无法表达 —— 那是把素材移出文件夹的合法操作。</p>
 *
 * <p>注意 {@code reviewStatus} 与 {@code licenseStatus} 是两个独立字段：
 * 允许同一次请求都改，但后端不做任何推断（审核通过不会自动给授权）。</p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record UpdateAssetRequest(
        String name,
        List<String> tags,
        String folderId,
        AssetStates.LicenseStatus licenseStatus,
        String licenseDetails,
        AssetStates.ReviewStatus reviewStatus,
        AssetStates.Availability availability,
        AssetStates.ProcessingStatus processingStatus,
        String processingError,
        boolean touchLastUsed) {

    /** 是否要求移动文件夹（区分「不改」与「移回根」）。 */
    public boolean movesFolder() {
        return folderId != null;
    }

    /** 移动目标文件夹；空串转成 null 表示根目录。 */
    public String targetFolderId() {
        return folderId == null || folderId.isBlank() ? null : folderId;
    }
}
