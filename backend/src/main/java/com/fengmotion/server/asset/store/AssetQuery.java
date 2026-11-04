package com.fengmotion.server.asset.store;

import com.fengmotion.server.asset.domain.AssetStates;

/**
 * 素材列表查询条件。
 *
 * <p>刻意不用「把一堆 String 传进去」的写法：枚举字段在编译期就限定取值，
 * 传错组合（例如把 mediaType 传成 reviewStatus 的值）不会静默查出一堆空结果。</p>
 *
 * @param mediaType        媒体类型
 * @param sourceType       来源类型
 * @param reviewStatus     审核状态
 * @param availability     可用状态
 * @param licenseStatus    授权状态
 * @param processingStatus 处理状态
 * @param folderId         文件夹；{@code null} 且 {@code rootOnly=false} 表示不限
 * @param rootOnly         只看根目录（folderId 为 null 的素材）
 * @param q                名称/标签子串；null 表示不搜
 * @param tag              单个标签子串
 * @param sort             recent / name / size / created
 * @param limit            每页数量
 * @param offset           偏移量
 */
public record AssetQuery(
        AssetStates.MediaType mediaType,
        AssetStates.SourceType sourceType,
        AssetStates.ReviewStatus reviewStatus,
        AssetStates.Availability availability,
        AssetStates.LicenseStatus licenseStatus,
        AssetStates.ProcessingStatus processingStatus,
        String folderId,
        boolean rootOnly,
        String q,
        String tag,
        String sort,
        int limit,
        int offset) {

    /** LIKE 的通配串：{@code %q%}，并把 q 里的 % 和 _ 转义，避免用户输入被当成通配符。 */
    public String qLike() {
        return likePattern(q);
    }

    public String tagLike() {
        return likePattern(tag);
    }

    /**
     * 把用户输入转成 LIKE 模式串。
     *
     * <p>不转义时，用户搜 {@code 100%} 会变成「任意后缀」，搜 {@code a_b} 会把 {@code _}
     * 当成单字符通配 —— 搜出来的结果和用户输入的字面含义不一致。</p>
     */
    private static String likePattern(String raw) {
        if (raw == null) {
            return null;
        }
        String escaped = raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return "%" + escaped + "%";
    }
}
