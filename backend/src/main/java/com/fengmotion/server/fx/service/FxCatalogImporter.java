package com.fengmotion.server.fx.service;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.fx.domain.FxParam;
import com.fengmotion.server.fx.domain.FxStates;
import com.fengmotion.server.fx.domain.FxTechnique;
import com.fengmotion.server.fx.store.FxTechniqueRepository;

/**
 * 内置技法目录的导入。
 *
 * <p>数据来自前端源码 {@code src/data/fxTechniques.ts}（从 workflow-gallery 的 fx 注册表抽出），
 * 已转成 {@code resources/fx/techniques.json}。这里只负责**搬运**，不重新设计字段 ——
 * 源库的字段语义（尤其 {@code execType}）必须原样保留。</p>
 *
 * <p><strong>最重要的一条规则</strong>：{@code execType} 是源库声明的能力标签，
 * 导入时**不能**据此推断本机可执行。所有技法一律 {@code not-implemented}，
 * 除非将来真的接上适配器。把「源库说它能跑」当成「我们能跑」，
 * 用户点下去会发现什么都没有 —— 那是这类库里最容易犯的谎。</p>
 */
@Service
public class FxCatalogImporter {

    private static final Logger log = LoggerFactory.getLogger(FxCatalogImporter.class);

    private static final String RESOURCE = "fx/techniques.json";

    private final FxTechniqueRepository repository;
    private final ObjectMapper json;

    public FxCatalogImporter(FxTechniqueRepository repository, ObjectMapper json) {
        this.repository = repository;
        this.json = json;
    }

    /** 导入结果。 */
    public record ImportResult(int total, int imported, int skipped) {
    }

    /**
     * 导入（或刷新）内置技法。
     *
     * <p>幂等：按 ID upsert，重复执行不会产生重复条目。已存在的条目不覆盖
     * {@code executionStatus} —— 那是本机事实，不该被目录刷新改回默认值。</p>
     *
     * @param force 为 true 时连 executionStatus 一起重置（仅用于测试与排障）
     */
    @Transactional
    public ImportResult importBuiltin(boolean force) {
        List<Map<String, Object>> raw = readResource();
        int imported = 0;
        int skipped = 0;
        for (Map<String, Object> item : raw) {
            try {
                FxTechnique technique = toTechnique(item, force);
                repository.upsert(technique);
                imported += 1;
            } catch (RuntimeException ex) {
                // 单条数据有问题不该让整个目录导入失败，但必须记下来 ——
                // 静默跳过会让「目录少了一条」变得查不出来。
                log.warn("跳过一条技法数据（id={}）：{}", item.get("id"), ex.getMessage());
                skipped += 1;
            }
        }
        log.info("特效目录导入完成：共 {} 条，成功 {}，跳过 {}", raw.size(), imported, skipped);
        return new ImportResult(raw.size(), imported, skipped);
    }

    /** 库里是否还没有技法（启动时决定要不要导入）。 */
    public boolean isEmpty() {
        return repository.countAll() == 0;
    }

    private List<Map<String, Object>> readResource() {
        ClassPathResource resource = new ClassPathResource(RESOURCE);
        if (!resource.exists()) {
            throw new IllegalStateException("缺少内置技法数据：" + RESOURCE);
        }
        try (InputStream in = resource.getInputStream()) {
            return json.readValue(in, new com.fasterxml.jackson.core.type.TypeReference<>() {
            });
        } catch (IOException ex) {
            throw new IllegalStateException("读取内置技法数据失败", ex);
        }
    }

    @SuppressWarnings("unchecked")
    private FxTechnique toTechnique(Map<String, Object> item, boolean force) {
        String id = requireString(item, "id");
        String existingStatus = repository.findById(id)
                .map(t -> t.executionStatus().wire())
                .orElse(null);
        // 已存在的条目保留原有的 executionStatus（本机事实），除非显式要求重置。
        FxStates.ExecutionStatus execution = (existingStatus != null && !force)
                ? FxStates.ExecutionStatus.fromWire(existingStatus)
                : FxStates.ExecutionStatus.NOT_IMPLEMENTED;

        FxStates.Category category = FxStates.Category.fromWire(requireString(item, "category"));
        FxStates.ExecType execType = FxStates.ExecType.fromWire(requireString(item, "execType"));
        FxStates.Impl impl = FxStates.Impl.fromWire(requireString(item, "impl"));

        List<FxStates.InputKind> inputKinds = new ArrayList<>();
        for (Object kind : asList(item.get("inputKinds"))) {
            FxStates.InputKind parsed = FxStates.InputKind.fromWire(String.valueOf(kind));
            if (parsed != null) {
                inputKinds.add(parsed);
            }
        }

        List<FxParam> params = new ArrayList<>();
        for (Object p : asList(item.get("params"))) {
            if (p instanceof Map<?, ?> map) {
                params.add(new FxParam(
                        stringOrEmpty(map.get("key")),
                        stringOrEmpty(map.get("label")),
                        stringOrEmpty(map.get("value")),
                        stringOrEmpty(map.get("hint"))));
            }
        }

        return new FxTechnique(
                id,
                requireString(item, "name"),
                stringOrEmpty(item.get("nameEn")),
                asStringList(item.get("aliases")),
                asStringList(item.get("keywords")),
                stringOrEmpty(item.get("intent")),
                category,
                // 展示名优先用数据里的；缺失时用枚举自带的中文名，避免界面出现空白。
                stringOrDefault(item.get("categoryLabel"), category.label()),
                asStringList(item.get("scenes")),
                asStringList(item.get("antiScenes")),
                execType,
                stringOrDefault(item.get("execLabel"), execType.label()),
                execution,
                impl,
                stringOrDefault(item.get("implLabel"), impl.label()),
                item.get("complexity") instanceof Number n ? n.intValue() : 1,
                inputKinds,
                asStringList(item.get("inputLabels")),
                stringOrEmpty(item.get("inputRequirement")),
                stringOrEmpty(item.get("output")),
                asStringList(item.get("dependencies")),
                asStringList(item.get("steps")),
                asStringList(item.get("compatibility")),
                asStringList(item.get("limitations")),
                asStringList(item.get("failures")),
                params,
                // 源数据用 previewImage/previewVideo，契约用 *_Url。
                stringOrEmpty(item.get("previewImage")),
                item.get("previewVideo") == null ? null : String.valueOf(item.get("previewVideo")),
                stringOrEmpty(item.get("previewCaption")),
                asStringList(item.get("related")),
                asStringList(item.get("alternatives")),
                Boolean.TRUE.equals(item.get("featured")),
                stringOrDefault(item.get("version"), "1.0.0"),
                parseUpdatedAt(item.get("updatedAt")),
                // 内置目录本身就是演示/示例数据的一部分，如实标注。
                true);
    }

    /**
     * 解析更新时间。
     *
     * <p>源数据是纯日期（{@code 2026-10-10}），契约要求 ISO 8601。
     * 纯日期按当天零点转，不假装有具体时刻。</p>
     */
    private static Instant parseUpdatedAt(Object value) {
        if (value == null) {
            return Instant.EPOCH;
        }
        String text = String.valueOf(value).trim();
        try {
            return Instant.parse(text);
        } catch (DateTimeParseException ignored) {
            // 不是完整时间戳，再试纯日期。
        }
        try {
            return LocalDate.parse(text).atStartOfDay(java.time.ZoneOffset.UTC).toInstant();
        } catch (DateTimeParseException ex) {
            return Instant.EPOCH;
        }
    }

    private static String requireString(Map<String, Object> item, String key) {
        Object value = item.get(key);
        if (value == null || String.valueOf(value).isBlank()) {
            throw new IllegalArgumentException("缺少必填字段 " + key);
        }
        return String.valueOf(value);
    }

    private static String stringOrEmpty(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private static String stringOrDefault(Object value, String fallback) {
        String text = stringOrEmpty(value);
        return text.isBlank() ? fallback : text;
    }

    private static List<?> asList(Object value) {
        return value instanceof List<?> list ? list : List.of();
    }

    private static List<String> asStringList(Object value) {
        List<String> result = new ArrayList<>();
        for (Object item : asList(value)) {
            result.add(String.valueOf(item));
        }
        return result;
    }
}
