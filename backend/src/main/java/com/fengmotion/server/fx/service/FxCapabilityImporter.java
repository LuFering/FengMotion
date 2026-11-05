package com.fengmotion.server.fx.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.stream.Stream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.fx.domain.FxParam;
import com.fengmotion.server.fx.domain.FxStates;
import com.fengmotion.server.fx.domain.FxTechnique;
import com.fengmotion.server.fx.store.FxTechniqueRepository;

/**
 * 把 {@code capabilities/} 里的三个开源技能库导入特效库。
 *
 * <p>这三个库此前只进了语义索引，用户能搜到但<strong>点不进去</strong> ——
 * 因为它们在特效目录里不存在。本类负责把它们变成真正的条目：
 * 可浏览、可收藏、可检索、能看到来源与许可。</p>
 *
 * <p><strong>三条不能妥协的规则</strong>：</p>
 * <ol>
 *   <li><strong>来源必须如实</strong>：项目名、链接、版本、许可、署名，缺什么就留空，
 *       不猜、不补「latest」。用户要靠这些判断能不能商用。</li>
 *   <li><strong>不谎报可执行</strong>：这些条目一律 {@code not-implemented}。
 *       有源码 ≠ 我们能跑 —— 依赖、适配、参数都还没做。</li>
 *   <li><strong>重复导入不丢用户数据</strong>：按 ID upsert，已存在的条目保留
 *       原来的 {@code executionStatus}（本机事实），收藏在独立表里不受影响。</li>
 * </ol>
 *
 * <p>不做的事：不执行任何仓库里的安装脚本；不下载远程预览视频（只记录链接，
 * 是否可访问由界面层决定并如实降级）。</p>
 */
@Service
public class FxCapabilityImporter {

    private static final Logger log = LoggerFactory.getLogger(FxCapabilityImporter.class);

    /** lemo 风格条目的 ID 前缀。带上来源前缀，避免和内置技法撞 ID。 */
    private static final String LEMO_PREFIX = "lemo-";
    /** shotcraft 镜头卡的 ID 前缀。 */
    private static final String SHOT_PREFIX = "shot-";

    /** 各仓库的固定元信息。集中一处，避免散落在每个解析方法里。 */
    private static final String LEMO_REPO = "https://github.com/lemomo-ai/lemo-opuscar";
    private static final String LEMO_ATTRIBUTION = "LemoLab（代码与文档 MIT；样片视频及静帧 CC BY 4.0，"
            + "转载或商用须署名 LemoLab 并附仓库链接）";
    private static final String SHOTCRAFT_REPO = "https://github.com/vincentwei1021/video-shotcraft";

    private final FxTechniqueRepository repository;
    private final ObjectMapper json;

    @Value("${fengmotion.retrieval.capabilities-dir:}")
    private String capabilitiesDir;

    public FxCapabilityImporter(FxTechniqueRepository repository, ObjectMapper json) {
        this.repository = repository;
        this.json = json;
    }

    /** 导入结果。 */
    public record ImportResult(int imported, int skipped, String note) {
    }

    /**
     * 导入全部能力库条目。
     *
     * <p>目录未配置时如实返回说明，不假装成功 —— 否则用户会以为「导入完成了」
     * 而页面上什么都没有。</p>
     *
     * @return 导入结果
     */
    @Transactional
    public ImportResult importAll() {
        if (capabilitiesDir == null || capabilitiesDir.isBlank()) {
            return new ImportResult(0, 0, "未配置 capabilities 目录（fengmotion.retrieval.capabilities-dir）");
        }
        Path root = Path.of(capabilitiesDir);
        if (!Files.isDirectory(root)) {
            return new ImportResult(0, 0, "capabilities 目录不存在：" + root);
        }

        List<FxTechnique> collected = new ArrayList<>();
        int rejected = 0;
        rejected += importStyles(root.resolve("lemo-opuscar/styles"), collected);
        rejected += importShotCards(root.resolve("video-shotcraft/references/shots"), collected);

        Instant now = Instant.now();
        int imported = 0;
        for (FxTechnique technique : collected) {
            try {
                repository.upsert(withPreservedStatus(technique, now));
                imported++;
            } catch (RuntimeException ex) {
                /* 单条失败不该让整批泡汤，但必须留下记录 —— 静默跳过会让
                   「页面上少了几条」变成查不出来的问题。 */
                log.warn("导入能力库条目失败（id={}）：{}", technique.id(), ex.getMessage());
                rejected++;
            }
        }
        log.info("能力库导入完成：成功 {}，跳过 {}", imported, rejected);
        return new ImportResult(imported, rejected, null);
    }

    /**
     * 保留已存在条目的执行状态。
     *
     * <p>{@code executionStatus} 是「这台机器能不能跑」的本机事实。
     * 目录刷新把它重置成默认值，会让用户已经验证过的状态凭空消失。</p>
     */
    private FxTechnique withPreservedStatus(FxTechnique fresh, Instant importedAt) {
        FxStates.ExecutionStatus status = repository.findById(fresh.id())
                .map(FxTechnique::executionStatus)
                .orElse(FxStates.ExecutionStatus.NOT_IMPLEMENTED);
        return new FxTechnique(
                fresh.id(), fresh.name(), fresh.nameEn(), fresh.aliases(), fresh.keywords(),
                fresh.intent(), fresh.category(), fresh.categoryLabel(), fresh.scenes(),
                fresh.antiScenes(), fresh.execType(), fresh.execLabel(), status, fresh.impl(),
                fresh.implLabel(), fresh.complexity(), fresh.inputKinds(), fresh.inputLabels(),
                fresh.inputRequirement(), fresh.output(), fresh.dependencies(), fresh.steps(),
                fresh.compatibility(), fresh.limitations(), fresh.failures(), fresh.params(),
                fresh.previewImageUrl(), fresh.previewVideoUrl(), fresh.previewCaption(),
                fresh.related(), fresh.alternatives(), fresh.featured(), fresh.version(),
                fresh.updatedAt(), fresh.demo(),
                fresh.sourceKind(), fresh.sourceProject(), fresh.sourceUrl(), fresh.sourceVersion(),
                fresh.licenseCode(), fresh.licensePreview(), fresh.attribution(),
                fresh.sourcePath(), importedAt);
    }

    /**
     * lemo-opuscar 的影片风格。
     *
     * <p>每个风格目录里有 {@code style.json}（结构化元数据）、{@code STYLE.md}
     * （视觉语言说明）与 {@code poster.jpg}（海报）。这里以 style.json 为主，
     * 因为它是唯一可靠的结构化来源；STYLE.md 只取首段作为「意图」。</p>
     *
     * @return 被拒绝的条目数
     */
    private int importStyles(Path styles, List<FxTechnique> out) {
        if (!Files.isDirectory(styles)) {
            log.info("未找到 lemo 风格目录，跳过：{}", styles);
            return 0;
        }
        int rejected = 0;
        try (Stream<Path> dirs = Files.list(styles)) {
            for (Path dir : dirs.toList()) {
                if (!Files.isDirectory(dir)) continue;
                Path meta = dir.resolve("style.json");
                if (!Files.isRegularFile(meta)) continue;
                try {
                    out.add(toStyle(dir, meta));
                } catch (RuntimeException | IOException ex) {
                    log.warn("跳过风格 {}：{}", dir.getFileName(), ex.getMessage());
                    rejected++;
                }
            }
        } catch (IOException unreadable) {
            log.warn("读取 lemo 风格目录失败：{}", unreadable.getMessage());
            return rejected + 1;
        }
        return rejected;
    }

    private FxTechnique toStyle(Path dir, Path meta) throws IOException {
        JsonNode node = json.readTree(Files.readString(meta, StandardCharsets.UTF_8));
        String slug = text(node, "slug");
        if (slug.isBlank()) slug = dir.getFileName().toString();
        String cn = text(node, "cn");
        String en = text(node, "en");
        String name = cn.isBlank() ? en : cn;
        if (name.isBlank()) name = slug;

        /* 一个风格能否用于创作，用户最先问的是「它长什么样、适合什么场合」。
           line_cn 是一句话描述，uses 是适用场合 —— 两者都进意图与场景，
           这样界面上不用点开就能判断要不要用。 */
        String line = text(node, "line_cn").isBlank() ? text(node, "line") : text(node, "line_cn");
        List<String> uses = new ArrayList<>();
        JsonNode usesNode = node.path("uses");
        if (usesNode.isArray()) {
            for (JsonNode item : usesNode) {
                String v = item.asText("");
                if (!v.isBlank()) uses.add(v);
            }
        }

        String excerpt = firstParagraph(dir.resolve("STYLE.md"));
        Path poster = dir.resolve("poster.jpg");
        /* 海报是本地真实文件；预览视频只在 Releases 里，本机没有。
           只给海报、不给视频，界面就会如实显示「暂无动态预览」。
           不把远程 mp4 写进 previewVideoUrl：那会让人以为本地已有该文件。

           这里存的是「在能力库里的相对位置」，不是完整 URL，也不带 /api：
           前端统一按 API base 解析所有地址（base 本身以 /api 结尾），
           再带一层 /api 会被拼成 /api/api/...，实测过，图片全部 404。
           WebConfig.CAPABILITY_PREFIX 负责把它挂到对外的访问路径上。 */
        String posterUrl = Files.isRegularFile(poster)
                ? "lemo-opuscar/styles/" + slug + "/poster.jpg"
                : "";

        String categoryLabel = text(node, "category_cn");
        return new FxTechnique(
                LEMO_PREFIX + slug,
                name,
                en,
                List.of(slug),
                uses,
                line.isBlank() ? excerpt : line,
                styleCategory(categoryLabel),
                categoryLabel.isBlank() ? "风格" : categoryLabel,
                uses,
                /* antiScenes 留空而不是编一段：STYLE.md 里确实写了「不要做成什么」，
                   但那是自然语言段落，硬转成短句列表会失真。 */
                List.of(),
                /* 源库只提供「风格说明 + 演示源码」，没有可调用的渲染适配器。
                   标 reference：可参考，不能一键跑。 */
                FxStates.ExecType.REFERENCE,
                "仅参考",
                FxStates.ExecutionStatus.NOT_IMPLEMENTED,
                FxStates.Impl.AI,
                "AI 生成",
                /* 复杂度按是否含角色/透视等结构性要求粗分，只是排序用的近似值，
                   不是精确度量。 */
                3,
                List.of(),
                List.of(),
                "",
                "风格说明 + 演示源码",
                List.of(),
                List.of(),
                List.of(),
                List.of(),
                List.of(),
                List.of(),
                posterUrl,
                /* 预览视频：官方画廊有，但本机没有文件，且链接可用性未验证。
                   留空并写明出处，比给一个可能打不开的链接诚实。 */
                null,
                "本地无预览视频；官方画廊 https://lemomo-ai.github.io/lemo-opuscar/ 有对应样片",
                List.of(),
                List.of(),
                false,
                "1.0.0",
                /* 用源文件的最后修改时间当「来源版本时间」，而不是 Instant.EPOCH：
                   EPOCH 会在界面上显示成 1970-01-01，看起来像数据坏了（实测截图见过）。
                   文件不存在时退回导入时刻，仍然是有意义的真实时间。 */
                lastModified(meta),
                false,
                "lemo",
                "lemo-opuscar",
                LEMO_REPO,
                text(node, "num"),
                "MIT",
                "CC BY 4.0",
                LEMO_ATTRIBUTION,
                dir.toString(),
                null);
    }

    /** lemo 的分类是「图形与排版」这类中文短标签，直接映射到特效库的分类。 */
    private FxStates.Category styleCategory(String label) {
        String l = label == null ? "" : label;
        if (l.contains("排版") || l.contains("文字") || l.contains("字体")) {
            return FxStates.Category.STYLIZE;
        }
        return FxStates.Category.STYLIZE;
    }

    /**
     * video-shotcraft 的镜头配方卡。
     *
     * <p>每张卡是一个 markdown，带 front matter：
     * {@code name} / {@code 一句话} / {@code 适用} / {@code 时长} / {@code 能量}。
     * 这些字段直接对应用户选卡时要判断的东西。</p>
     *
     * @return 被拒绝的条目数
     */
    private int importShotCards(Path shots, List<FxTechnique> out) {
        if (!Files.isDirectory(shots)) {
            log.info("未找到 shotcraft 镜头卡目录，跳过：{}", shots);
            return 0;
        }
        int rejected = 0;
        try (Stream<Path> walk = Files.walk(shots, 3)) {
            for (Path file : walk.filter(Files::isRegularFile).toList()) {
                String fileName = file.getFileName().toString();
                if (!fileName.endsWith(".md")) continue;
                if (isRepoDoc(fileName)) continue;
                try {
                    out.add(toShotCard(file, shots));
                } catch (RuntimeException | IOException ex) {
                    log.warn("跳过镜头卡 {}：{}", fileName, ex.getMessage());
                    rejected++;
                }
            }
        } catch (IOException unreadable) {
            log.warn("读取 shotcraft 目录失败：{}", unreadable.getMessage());
            return rejected + 1;
        }
        return rejected;
    }

    private FxTechnique toShotCard(Path file, Path shotsRoot) throws IOException {
        String raw = Files.readString(file, StandardCharsets.UTF_8);
        String name = frontMatter(raw, "name");
        if (name.isBlank()) name = file.getFileName().toString().replace(".md", "");
        String oneLine = frontMatter(raw, "一句话");
        String fit = frontMatter(raw, "适用");
        String duration = frontMatter(raw, "时长");

        String relative = shotsRoot.relativize(file).toString();
        String categoryDir = relative.contains("/") ? relative.substring(0, relative.indexOf('/')) : "";

        return new FxTechnique(
                SHOT_PREFIX + name,
                name,
                name,
                List.of(),
                /* 把分类目录也当检索词：用户会说「转场镜头」，而卡片名可能是英文。 */
                categoryDir.isBlank() ? List.of() : List.of(categoryDir),
                oneLine,
                shotCategory(categoryDir),
                shotCategoryLabel(categoryDir),
                fit.isBlank() ? List.of() : List.of(fit),
                List.of(),
                FxStates.ExecType.REFERENCE,
                "仅参考",
                FxStates.ExecutionStatus.NOT_IMPLEMENTED,
                FxStates.Impl.OFFLINE,
                "离线",
                3,
                List.of(FxStates.InputKind.VIDEO),
                List.of("视频"),
                "",
                "镜头配方 + Remotion 示例源码",
                List.of(),
                /* 时长是源库给的参考值，直接进步骤说明区而不另造字段。 */
                duration.isBlank() ? List.of() : List.of("参考时长：" + duration),
                List.of(),
                List.of(),
                List.of(),
                List.of(),
                "",
                null,
                "本地无预览视频；官方画廊 https://vincentwei1021.github.io/video-shotcraft/ 有动态样片",
                List.of(),
                List.of(),
                false,
                "1.0.0",
                lastModified(file),
                false,
                "shotcraft",
                "video-shotcraft",
                SHOTCRAFT_REPO,
                "",
                /* shotcraft 的许可需逐个确认：仓库里只有 ATTRIBUTION.md 说明引用来源，
                   没有统一 license 文件。这里如实留空，不写「MIT」这种没依据的结论。 */
                "",
                "",
                "" + SHOTCRAFT_REPO,
                file.toString(),
                null);
    }

    private FxStates.Category shotCategory(String dir) {
        if (dir == null) return FxStates.Category.CAMERA;
        return switch (dir) {
            case "transition" -> FxStates.Category.TRANSITION;
            case "camera" -> FxStates.Category.CAMERA;
            case "typography" -> FxStates.Category.TYPOGRAPHY;
            case "effects" -> FxStates.Category.COMPOSITING;
            case "opening", "outro" -> FxStates.Category.TYPOGRAPHY;
            case "interaction", "ui-entrance" -> FxStates.Category.COMPOSITING;
            case "data" -> FxStates.Category.COMPOSITING;
            default -> FxStates.Category.COMPOSITING;
        };
    }

    private String shotCategoryLabel(String dir) {
        if (dir == null || dir.isBlank()) return "镜头";
        return switch (dir) {
            case "transition" -> "转场";
            case "camera" -> "运镜";
            case "typography" -> "文字";
            case "effects" -> "特效";
            case "opening" -> "开场";
            case "outro" -> "收尾";
            case "interaction" -> "交互";
            case "ui-entrance" -> "界面入场";
            case "data" -> "数据";
            case "rhythm" -> "节奏";
            default -> "镜头";
        };
    }

    /** 读取 front matter 里的单行字段；没有 front matter 时返回空串。 */
    static String frontMatter(String raw, String key) {
        if (raw == null || !raw.startsWith("---")) return "";
        int end = raw.indexOf("\n---", 3);
        String block = end > 0 ? raw.substring(3, end) : raw.substring(3);
        for (String line : block.split("\n")) {
            int colon = line.indexOf(':');
            if (colon <= 0) continue;
            if (line.substring(0, colon).trim().equals(key)) {
                return line.substring(colon + 1).trim();
            }
        }
        return "";
    }

    /** 取 markdown 第一个非标题段落，用作风格的一句话说明。 */
    private String firstParagraph(Path file) {
        if (!Files.isRegularFile(file)) return "";
        try {
            String raw = Files.readString(file, StandardCharsets.UTF_8);
            for (String block : raw.split("\n\n")) {
                String trimmed = block.strip();
                if (trimmed.isEmpty() || trimmed.startsWith("#") || trimmed.startsWith(">")) continue;
                return trimmed.length() > 400 ? trimmed.substring(0, 400) : trimmed;
            }
        } catch (IOException unreadable) {
            return "";
        }
        return "";
    }

    private static boolean isRepoDoc(String fileName) {
        String lower = fileName.toLowerCase(Locale.ROOT);
        return lower.startsWith("readme") || lower.startsWith("attribution")
                || lower.startsWith("license") || lower.startsWith("changelog");
    }

    private static String text(JsonNode node, String field) {
        return node.path(field).asText("");
    }

    /** 生成一个稳定 ID（仅用于将来「用户自建条目」；导入条目用前缀 + slug）。 */
    static String newId(String prefix) {
        return prefix + UUID.randomUUID();
    }

    /**
     * 源文件的最后修改时间。
     *
     * <p>不用 {@code Instant.EPOCH} 当占位：它会在界面上显示成 1970-01-01，
     * 用户会以为数据损坏。文件时间读不到时退回当前时刻，仍然是真实时间点。</p>
     */
    private static Instant lastModified(Path file) {
        try {
            return Files.getLastModifiedTime(file).toInstant();
        } catch (IOException unreadable) {
            return Instant.now();
        }
    }
}
