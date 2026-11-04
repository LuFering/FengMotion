package com.fengmotion.server.fx.store.impl;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.fx.domain.FxParam;
import com.fengmotion.server.fx.domain.FxStates;
import com.fengmotion.server.fx.domain.FxTechnique;
import com.fengmotion.server.fx.store.FxTechniqueRepository;
import com.fengmotion.server.fx.store.mapper.FxTechniqueMapper;
import com.fengmotion.server.fx.store.mapper.FxTechniqueRow;
import com.fengmotion.server.fx.store.mapper.FxUserStateMapper;

/**
 * 特效库持久化的 SQLite 实现。
 *
 * <p>JSON 与枚举的转换集中在这里：Mapper 不碰它们，业务层也看不到裸字符串。</p>
 */
@Repository
public class SqliteFxTechniqueRepository implements FxTechniqueRepository {

    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {
    };
    private static final TypeReference<List<FxParam>> PARAM_LIST = new TypeReference<>() {
    };

    private final FxTechniqueMapper techniques;
    private final FxUserStateMapper userStates;
    private final ObjectMapper json;

    public SqliteFxTechniqueRepository(FxTechniqueMapper techniques, FxUserStateMapper userStates,
            ObjectMapper json) {
        this.techniques = techniques;
        this.userStates = userStates;
        this.json = json;
    }

    @Override
    public void upsert(FxTechnique t) {
        FxTechniqueRow row = new FxTechniqueRow();
        row.setId(t.id());
        row.setName(t.name());
        row.setNameEn(t.nameEn());
        row.setAliasesJson(write(t.aliases()));
        row.setKeywordsJson(write(t.keywords()));
        row.setIntent(t.intent());
        row.setCategory(t.category().wire());
        row.setCategoryLabel(t.categoryLabel());
        row.setScenesJson(write(t.scenes()));
        row.setAntiScenesJson(write(t.antiScenes()));
        row.setExecType(t.execType().wire());
        row.setExecLabel(t.execLabel());
        row.setExecutionStatus(t.executionStatus().wire());
        row.setImpl(t.impl().wire());
        row.setImplLabel(t.implLabel());
        row.setComplexity(t.complexity());
        row.setInputKindsJson(write(t.inputKinds().stream().map(FxStates.InputKind::wire).toList()));
        row.setInputLabelsJson(write(t.inputLabels()));
        row.setInputRequirement(t.inputRequirement());
        row.setOutput(t.output());
        row.setDependenciesJson(write(t.dependencies()));
        row.setStepsJson(write(t.steps()));
        row.setCompatibilityJson(write(t.compatibility()));
        row.setLimitationsJson(write(t.limitations()));
        row.setFailuresJson(write(t.failures()));
        row.setParamsJson(writeObjects(t.params()));
        row.setPreviewImageUrl(t.previewImageUrl());
        row.setPreviewVideoUrl(t.previewVideoUrl());
        row.setPreviewCaption(t.previewCaption());
        row.setRelatedJson(write(t.related()));
        row.setAlternativesJson(write(t.alternatives()));
        row.setFeatured(t.featured() ? 1 : 0);
        row.setVersion(t.version());
        row.setUpdatedAt(t.updatedAt().toString());
        row.setDemo(t.demo() ? 1 : 0);
        techniques.upsert(row);
    }

    @Override
    public Optional<FxTechnique> findById(String id) {
        return Optional.ofNullable(techniques.findById(id)).map(this::toDomain);
    }

    @Override
    public int countAll() {
        return techniques.countAll();
    }

    @Override
    public List<FxTechnique> search(FxQuery q) {
        List<FxTechniqueRow> rows = techniques.search(
                wire(q.category()), wire(q.execType()), wire(q.impl()),
                q.inputKind() == null ? null : q.inputKind().wire(), q.inputKindLike(),
                q.maxComplexity(), q.featured(), q.onlyFavorited(), q.q(), q.qLike(), q.sort(),
                q.limit(), q.offset());
        List<FxTechnique> result = new ArrayList<>(rows.size());
        for (FxTechniqueRow row : rows) {
            result.add(toDomain(row));
        }
        return result;
    }

    @Override
    public int count(FxQuery q) {
        return techniques.count(
                wire(q.category()), wire(q.execType()), wire(q.impl()),
                q.inputKind() == null ? null : q.inputKind().wire(), q.inputKindLike(),
                q.maxComplexity(), q.featured(), q.onlyFavorited(), q.q(), q.qLike());
    }

    @Override
    public Map<String, Map<String, Integer>> facets() {
        Map<String, Map<String, Integer>> result = new LinkedHashMap<>();
        result.put("categories", fill(FxStates.Category.values(), techniques.countByCategory(),
                FxStates.Category::wire));
        result.put("execTypes", fill(FxStates.ExecType.values(), techniques.countByExecType(),
                FxStates.ExecType::wire));
        result.put("impls", fill(FxStates.Impl.values(), techniques.countByImpl(), FxStates.Impl::wire));
        // 复杂度是 1–5 的数值，没有固定枚举，直接按实际出现的值给。
        Map<String, Integer> complexity = new LinkedHashMap<>();
        for (Map<String, Object> row : techniques.countByComplexity()) {
            if (row.get("k") instanceof Number k && row.get("c") instanceof Number c) {
                complexity.put(String.valueOf(k.intValue()), c.intValue());
            }
        }
        result.put("complexities", complexity);
        return result;
    }

    // ── 用户状态 ──

    @Override
    public Optional<UserState> userState(String techniqueId) {
        FxUserStateMapper.UserStateRow row = userStates.findByTechnique(techniqueId);
        if (row == null) {
            return Optional.empty();
        }
        return Optional.of(new UserState(
                row.getFavorited() != null && row.getFavorited() == 1,
                row.getLastViewedAt() == null ? null : Instant.parse(row.getLastViewedAt())));
    }

    @Override
    public void setFavorite(String techniqueId, boolean favorited) {
        userStates.upsertFavorite(techniqueId, favorited ? 1 : 0, Instant.now().toString());
    }

    @Override
    public void touchViewed(String techniqueId) {
        userStates.touchViewed(techniqueId, Instant.now().toString());
    }

    @Override
    public List<String> listFavorited() {
        return userStates.listFavorited();
    }

    // ── 转换 ──

    private FxTechnique toDomain(FxTechniqueRow row) {
        return new FxTechnique(
                row.getId(),
                row.getName(),
                row.getNameEn(),
                readStrings(row.getAliasesJson()),
                readStrings(row.getKeywordsJson()),
                row.getIntent(),
                FxStates.Category.fromWire(row.getCategory()),
                row.getCategoryLabel(),
                readStrings(row.getScenesJson()),
                readStrings(row.getAntiScenesJson()),
                FxStates.ExecType.fromWire(row.getExecType()),
                row.getExecLabel(),
                FxStates.ExecutionStatus.fromWire(row.getExecutionStatus()),
                FxStates.Impl.fromWire(row.getImpl()),
                row.getImplLabel(),
                row.getComplexity() == null ? 1 : row.getComplexity(),
                readStrings(row.getInputKindsJson()).stream()
                        .map(FxStates.InputKind::fromWire)
                        .filter(java.util.Objects::nonNull)
                        .toList(),
                readStrings(row.getInputLabelsJson()),
                row.getInputRequirement(),
                row.getOutput(),
                readStrings(row.getDependenciesJson()),
                readStrings(row.getStepsJson()),
                readStrings(row.getCompatibilityJson()),
                readStrings(row.getLimitationsJson()),
                readStrings(row.getFailuresJson()),
                readParams(row.getParamsJson()),
                row.getPreviewImageUrl(),
                row.getPreviewVideoUrl(),
                row.getPreviewCaption(),
                readStrings(row.getRelatedJson()),
                readStrings(row.getAlternativesJson()),
                row.getFeatured() != null && row.getFeatured() == 1,
                row.getVersion(),
                row.getUpdatedAt() == null ? Instant.EPOCH : Instant.parse(row.getUpdatedAt()),
                row.getDemo() != null && row.getDemo() == 1);
    }

    private static <E extends Enum<E>> Map<String, Integer> fill(E[] values,
            List<Map<String, Object>> rows, java.util.function.Function<E, String> wireOf) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (E value : values) {
            counts.put(wireOf.apply(value), 0);
        }
        for (Map<String, Object> row : rows) {
            if (row.get("k") instanceof String k && row.get("c") instanceof Number c) {
                counts.put(k, c.intValue());
            }
        }
        return counts;
    }

    private static String wire(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof FxStates.Category c) return c.wire();
        if (value instanceof FxStates.ExecType e) return e.wire();
        if (value instanceof FxStates.Impl i) return i.wire();
        throw new IllegalArgumentException("未处理的枚举：" + value.getClass());
    }

    private String write(List<String> values) {
        try {
            return json.writeValueAsString(values == null ? List.of() : values);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException("序列化失败", ex);
        }
    }

    private String writeObjects(List<FxParam> values) {
        try {
            return json.writeValueAsString(values == null ? List.of() : values);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException("序列化失败", ex);
        }
    }

    private List<String> readStrings(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        try {
            return json.readValue(text, STRING_LIST);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            // 单个字段损坏不该让整条技法读不出来。
            return List.of();
        }
    }

    private List<FxParam> readParams(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        try {
            return json.readValue(text, PARAM_LIST);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            return List.of();
        }
    }
}
