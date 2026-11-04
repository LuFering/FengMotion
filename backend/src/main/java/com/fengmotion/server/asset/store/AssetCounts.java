package com.fengmotion.server.asset.store;

import java.util.Map;

/**
 * 素材的全量分类计数（facets）。
 *
 * <p>口径：这些计数**不受当前筛选影响**，是「库里一共有哪些取值、各多少条」。
 * 若跟着筛选变化，用户就永远看不到其他分类还有多少东西，也就没机会切过去。</p>
 *
 * @param total        总数
 * @param mediaTypes   mediaType → 条数
 * @param sourceTypes  sourceType → 条数
 * @param reviewStatus reviewStatus → 条数
 * @param availability availability → 条数
 * @param licenseStatus licenseStatus → 条数
 */
public record AssetCounts(
        int total,
        Map<String, Integer> mediaTypes,
        Map<String, Integer> sourceTypes,
        Map<String, Integer> reviewStatus,
        Map<String, Integer> availability,
        Map<String, Integer> licenseStatus) {
}
