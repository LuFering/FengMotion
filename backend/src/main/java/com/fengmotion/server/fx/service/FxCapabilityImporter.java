package com.fengmotion.server.fx.service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.fx.domain.FxStates;
import com.fengmotion.server.fx.domain.FxTechnique;
import com.fengmotion.server.fx.service.capability.CapabilitySource;
import com.fengmotion.server.fx.store.FxTechniqueRepository;

/**
 * 把技能库目录导入特效库。
 *
 * <p><strong>从「三条写死路径」改成「格式驱动的通用导入」</strong>：
 * 导入器不再认识 lemo / shotcraft 的具体布局，只做三件事 ——
 * 遍历目录、问每个 {@link CapabilitySource} 认不认、把结果落成特效条目。
 * 新增一种格式只需多写一个解析器实现，这里不用改。</p>
 *
 * <p><strong>三条不妥协的规则</strong>：</p>
 * <ol>
 *   <li>来源如实：解析器给了什么就存什么，没给就留空，不猜、不补「latest」。</li>
 *   <li>不谎报可执行：一律 {@code not-implemented}。有源码 ≠ 能一键跑。</li>
 *   <li>重复导入不丢用户数据：按 ID upsert，保留已有 {@code executionStatus}；
 *       收藏在独立表，不受影响。</li>
 * </ol>
 */
@Service
public class FxCapabilityImporter {

    private static final Logger log = LoggerFactory.getLogger(FxCapabilityImporter.class);

    private final FxTechniqueRepository repository;
    private final List<CapabilitySource> sources;

    @Value("${fengmotion.retrieval.capabilities-dir:}")
    private String capabilitiesDir;

    public FxCapabilityImporter(FxTechniqueRepository repository, List<CapabilitySource> sources) {
        this.repository = repository;
        this.sources = sources;
    }

    /**
     * 导入结果。
     *
     * @param imported 写入条目数
     * @param skipped  认得出格式但无内容、或解析失败的文件数
     * @param note     未执行时的说明；正常执行时为 null
     */
    public record ImportResult(int imported, int skipped, String note) {
    }

    /** 导入配置目录下的全部技能库。 */
    @Transactional
    public ImportResult importAll() {
        if (capabilitiesDir == null || capabilitiesDir.isBlank()) {
            return new ImportResult(0, 0, "未配置 capabilities 目录（fengmotion.retrieval.capabilities-dir）");
        }
        Path root = Path.of(capabilitiesDir);
        if (!Files.isDirectory(root)) {
            return new ImportResult(0, 0, "capabilities 目录不存在：" + root);
        }
        return importFrom(root);
    }

    /**
     * 从任意目录导入。
     *
     * <p>根目录下每个子目录视为一个「来源库」，各自用全部解析器扫一遍。
     * 这样用户新增一个技能库时，只需要把目录放进来，不用改代码、不用改配置。</p>
     *
     * @param root 扫描根
     * @return 导入结果
     */
    @Transactional
    public ImportResult importFrom(Path root) {
        List<CapabilitySource.ParsedItem> collected = new ArrayList<>();
        int skipped = 0;

        List<Path> libraries = new ArrayList<>();
        try (Stream<Path> children = Files.list(root)) {
            for (Path child : children.toList()) {
                if (Files.isDirectory(child) && !isIgnoredDirectory(child)) {
                    libraries.add(child);
                }
            }
        } catch (Exception unreadable) {
            return new ImportResult(0, 0, "无法读取目录：" + root);
        }

        for (Path library : libraries) {
            for (CapabilitySource source : sources) {
                skipped += source.scan(library, collected);
            }
        }

        /* 同一 ID 可能被两个解析器同时产出（例如带 front matter 的 md 同时被
           FrontMatterSource 与 GenericMarkdownSource 认到）。GenericMarkdownSource
           已经在 supports 里排除了这类文件，但这里再按 ID 去一次重更稳妥：
           后出现的会覆盖先出现的，等于「更专用的解析器优先」（按 @Order 排序）。 */
        List<CapabilitySource.ParsedItem> unique = dedupe(collected);

        int imported = write(unique);
        log.info("能力库导入：{} 个来源库，解析 {} 条，去重后 {} 条，跳过 {}",
                libraries.size(), collected.size(), unique.size(), skipped);
        return new ImportResult(imported, skipped, null);
    }

    private static List<CapabilitySource.ParsedItem> dedupe(List<CapabilitySource.ParsedItem> items) {
        java.util.LinkedHashMap<String, CapabilitySource.ParsedItem> byId = new java.util.LinkedHashMap<>();
        for (CapabilitySource.ParsedItem item : items) {
            if (item.id() == null || item.id().isBlank()) {
                continue;
            }
            byId.put(item.id(), item);
        }
        return List.copyOf(byId.values());
    }

    /** 把解析结果落成特效条目；重复 ID 会覆盖（upsert），因此幂等。 */
    private int write(List<CapabilitySource.ParsedItem> items) {
        Instant now = Instant.now();
        int imported = 0;
        for (CapabilitySource.ParsedItem item : items) {
            try {
                repository.upsert(toTechnique(item, now));
                imported++;
            } catch (RuntimeException failed) {
                /* 单条失败不该让整批泡汤，但必须留痕：
                   静默跳过会让「页面上少了几条」变成查不出来的问题。 */
                log.warn("写入能力库条目失败（id={}）：{}", item.id(), failed.getMessage());
            }
        }
        return imported;
    }

    private FxTechnique toTechnique(CapabilitySource.ParsedItem item, Instant importedAt) {
        /* 保留已存在的执行状态：那是「这台机器能不能跑」的本机事实，
           目录刷新把它重置回默认值，会让用户验证过的状态凭空消失。 */
        FxStates.ExecutionStatus status = repository.findById(item.id())
                .map(FxTechnique::executionStatus)
                .orElse(FxStates.ExecutionStatus.NOT_IMPLEMENTED);

        String categoryLabel = item.categoryHint() == null || item.categoryHint().isBlank()
                ? "参考" : item.categoryHint();

        return new FxTechnique(
                item.id(),
                item.name(),
                nullToEmpty(item.nameEn()),
                List.of(),
                item.keywords() == null ? List.of() : item.keywords(),
                nullToEmpty(item.intent()),
                mapCategory(item.categoryHint()),
                categoryLabel,
                item.scenes() == null ? List.of() : item.scenes(),
                List.of(),
                /* 能力库条目都是「说明 + 源码」，没有可调用的执行适配器。 */
                FxStates.ExecType.REFERENCE,
                "仅参考",
                status,
                FxStates.Impl.AI,
                "AI 生成",
                3,
                List.of(),
                List.of(),
                "",
                "说明与源码参考",
                List.of(),
                item.steps() == null ? List.of() : item.steps(),
                List.of(),
                List.of(),
                List.of(),
                List.of(),
                item.previewImage() == null ? "" : item.previewImage(),
                null,
                "",
                List.of(),
                List.of(),
                false,
                "1.0.0",
                importedAt,
                false,
                /* source_kind 用来源项目名：它至少说明「这条来自哪个库」，
                   比一个统一叫 capability 的值更有用，也让界面能按库筛选。 */
                item.sourceProject() == null || item.sourceProject().isBlank()
                        ? "capability" : item.sourceProject(),
                nullToEmpty(item.sourceProject()),
                nullToEmpty(item.sourceUrl()),
                nullToEmpty(item.sourceVersion()),
                nullToEmpty(item.licenseCode()),
                nullToEmpty(item.licensePreview()),
                nullToEmpty(item.attribution()),
                nullToEmpty(item.sourcePath()),
                importedAt);
    }

    /**
     * 把源给的分类提示映射到特效库的分类枚举。
     *
     * <p>匹配不到时归到「合成」。不挑一个看起来接近的：
     * 分类错了用户会按错误的入口去找，而「合成」是一个可解释的兜底。</p>
     */
    static FxStates.Category mapCategory(String hint) {
        if (hint == null || hint.isBlank()) {
            return FxStates.Category.COMPOSITING;
        }
        String h = hint.toLowerCase(java.util.Locale.ROOT);
        /* 先判「风格」再判「排版」：lemo 的分类叫「图形与排版」，
           它描述的是整片视觉风格，不是文字动画。
           先匹配「排版」会把 52 个风格全归成文字动画 —— 测试抓到过。 */
        if (containsAny(h, "风格", "styl", "graphic", "图形")) return FxStates.Category.STYLIZE;
        if (containsAny(h, "运镜", "镜头", "camera")) return FxStates.Category.CAMERA;
        if (containsAny(h, "转场", "transition")) return FxStates.Category.TRANSITION;
        if (containsAny(h, "光", "light")) return FxStates.Category.LIGHTING;
        if (containsAny(h, "粒子", "particle")) return FxStates.Category.PARTICLES;
        if (containsAny(h, "文字", "排版", "type", "typography", "text")) return FxStates.Category.TYPOGRAPHY;
        return FxStates.Category.COMPOSITING;
    }

    private static boolean containsAny(String haystack, String... needles) {
        for (String needle : needles) {
            if (haystack.contains(needle)) {
                return true;
            }
        }
        return false;
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    /**
     * 是否是导入时该整体跳过的目录。
     *
     * <p>这些目录里放的是资产而不是条目：videos 是样片、assets 是素材、
     * demo/template 是实现工程。把它们当库扫，会把几百个文件当条目收进来。</p>
     */
    private static boolean isIgnoredDirectory(Path dir) {
        if (dir.getFileName() == null) {
            return true;
        }
        String name = dir.getFileName().toString().toLowerCase(java.util.Locale.ROOT);
        return name.startsWith(".")
                || name.equals("node_modules")
                || name.equals("dist")
                || name.equals("build")
                || name.equals("assets")
                || name.equals("videos")
                || name.equals("template")
                || name.equals("demos");
    }
}
