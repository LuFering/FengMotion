package com.fengmotion.server.asset.store.impl;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.stereotype.Repository;

import com.fengmotion.server.asset.domain.AssetStates;
import com.fengmotion.server.asset.store.AssetCounts;
import com.fengmotion.server.asset.store.mapper.AssetMapper;

/**
 * facets 计数的组装。
 *
 * <p>Mapper 返回的是 {@code [{k, c}]} 这类行；这里统一转成 {@code Map<String,Integer>}
 * 并补齐没出现过的取值为 0 —— 否则前端拿到的是「缺键」，筛选面板会少几个选项。</p>
 */
@Repository
public class AssetCountsReader {

    private final AssetMapper mapper;

    public AssetCountsReader(AssetMapper mapper) {
        this.mapper = mapper;
    }

    public AssetCounts read() {
        return new AssetCounts(
                mapper.countAll(),
                fill(AssetStates.MediaType.values(), mapper.countByMediaType(), AssetStates.MediaType::wire),
                fill(AssetStates.SourceType.values(), mapper.countBySourceType(), AssetStates.SourceType::wire),
                fill(AssetStates.ReviewStatus.values(), mapper.countByReviewStatus(), AssetStates.ReviewStatus::wire),
                fill(AssetStates.Availability.values(), mapper.countByAvailability(), AssetStates.Availability::wire),
                fill(AssetStates.LicenseStatus.values(), mapper.countByLicenseStatus(),
                        AssetStates.LicenseStatus::wire));
    }

    private static <E extends Enum<E>> Map<String, Integer> fill(
            E[] values, List<Map<String, Object>> rows, java.util.function.Function<E, String> wireOf) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (E value : values) {
            counts.put(wireOf.apply(value), 0);
        }
        for (Map<String, Object> row : rows) {
            Object key = row.get("k");
            Object count = row.get("c");
            if (key instanceof String text && count instanceof Number number) {
                counts.put(text, number.intValue());
            }
        }
        return counts;
    }

    /** 供仓储实现复用的空值兜底。 */
    static <T> Optional<T> orEmpty(T value) {
        return Optional.ofNullable(value);
    }
}
