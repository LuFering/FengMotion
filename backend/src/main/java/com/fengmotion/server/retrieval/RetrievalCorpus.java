package com.fengmotion.server.retrieval;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.asset.store.AssetRepository;
import com.fengmotion.server.fx.domain.FxTechnique;
import com.fengmotion.server.fx.store.FxTechniqueRepository;
import com.fengmotion.server.reference.domain.ReferenceSegment;
import com.fengmotion.server.reference.domain.ReferenceVideo;
import com.fengmotion.server.reference.store.ReferenceRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 把三库与 capabilities 变成可检索文本。
 *
 * <p><strong>为什么要有这一层</strong>：一个资源「能被搜到」靠的不是它的 ID，
 * 而是它的全部可读描述 —— 名称、别名、用途、适用场景、做法步骤、人工观察。
 * 只拿名称建索引，用户说「那种眩晕的变焦」就永远搜不到「多莉变焦」。</p>
 *
 * <p><strong>capabilities 也走进来</strong>：它们是创作素材的一种（风格、镜头卡、组件），
 * agent 在 lookdev / film-plan / 实现阶段要和特效一起被召回，而不是只在某个文档里
 * 留一行路径。这里把它们切成索引条目，与三库同表同检索。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RetrievalCorpus {

    /** capabilities 的索引来源标记。 */
    public static final String KIND_CAPABILITY = "capability";

    private final AssetRepository assets;
    private final FxTechniqueRepository techniques;
    private final ReferenceRepository references;
    private final ObjectMapper json;

    @Value("${fengmotion.retrieval.capabilities-dir:}")
    private String capabilitiesDir;

    /**
     * 收集全部可索引文本。
     *
     * @return 文档列表
     */
    public List<SemanticIndex.Doc> collect() {
        List<SemanticIndex.Doc> docs = new ArrayList<>();
        docs.addAll(fromAssets());
        docs.addAll(fromTechniques());
        docs.addAll(fromReferences());
        docs.addAll(fromCapabilities());
        return docs;
    }

    /**
     * 素材：名称 + 类型 + 标签。
     *
     * @return 文档
     */
    private List<SemanticIndex.Doc> fromAssets() {
        List<SemanticIndex.Doc> docs = new ArrayList<>();
        try {
            var query = new com.fengmotion.server.asset.store.AssetQuery(
                    null, null, null, null, null, null, null, false, null, null, "updated", 10000, 0);
            for (Asset asset : assets.search(query)) {
                StringBuilder sb = new StringBuilder(asset.name());
                sb.append("｜").append(asset.mediaType());
                if (asset.tags() != null && !asset.tags().isEmpty()) {
                    sb.append("｜标签：").append(String.join("、", asset.tags()));
                }
                docs.add(new SemanticIndex.Doc("asset", asset.id(), 0, sb.toString()));
            }
        } catch (RuntimeException failed) {
            log.warn("索引素材失败：{}", failed.getMessage());
        }
        return docs;
    }

    /**
     * 特效：名称、别名、意图、场景、步骤分段索引。
     *
     * <p>分段而不是拼成一长串：一长串里「步骤」会稀释「名称」的权重，
     * 搜具体技法名时反而排不到前面。</p>
     *
     * @return 文档
     */
    private List<SemanticIndex.Doc> fromTechniques() {
        List<SemanticIndex.Doc> docs = new ArrayList<>();
        try {
            var query = new com.fengmotion.server.fx.store.FxTechniqueRepository.FxQuery(
                    null, null, null, null, null, false, false, null, "name", 10000, 0);
            for (FxTechnique t : techniques.search(query)) {
                List<String> parts = new ArrayList<>();
                StringBuilder head = new StringBuilder(t.name());
                if (t.nameEn() != null && !t.nameEn().isBlank()) head.append("（").append(t.nameEn()).append("）");
                if (t.aliases() != null && !t.aliases().isEmpty()) {
                    head.append("｜别名：").append(String.join("、", t.aliases()));
                }
                parts.add(head.toString());
                if (t.intent() != null && !t.intent().isBlank()) parts.add("用途：" + t.intent());
                if (t.scenes() != null && !t.scenes().isEmpty()) {
                    parts.add("适用场景：" + String.join("、", t.scenes()));
                }
                if (t.steps() != null && !t.steps().isEmpty()) {
                    parts.add("做法：" + String.join("；", t.steps()));
                }
                for (int i = 0; i < parts.size(); i++) {
                    docs.add(new SemanticIndex.Doc("technique", t.id(), i, parts.get(i)));
                }
            }
        } catch (RuntimeException failed) {
            log.warn("索引特效失败：{}", failed.getMessage());
        }
        return docs;
    }

    /**
     * 参考片：标题、描述，加上每个片段的观察/推断/建议。
     *
     * @return 文档
     */
    private List<SemanticIndex.Doc> fromReferences() {
        List<SemanticIndex.Doc> docs = new ArrayList<>();
        try {
            for (ReferenceVideo video : references.searchVideos(videoQuery())) {
                StringBuilder head = new StringBuilder(video.title());
                if (video.description() != null && !video.description().isBlank()) {
                    head.append("｜").append(video.description());
                }
                if (video.tags() != null && !video.tags().isEmpty()) {
                    head.append("｜标签：").append(String.join("、", video.tags()));
                }
                docs.add(new SemanticIndex.Doc("reference", video.id(), 0, head.toString()));

                for (ReferenceSegment segment : references.findSegmentsByVideo(video.id())) {
                    List<String> parts = new ArrayList<>();
                    parts.add("片段观察：" + safe(segment.observation()));
                    if (segment.suggestion() != null && !segment.suggestion().isBlank()) {
                        parts.add("用法建议：" + segment.suggestion());
                    }
                    if (segment.tags() != null && !segment.tags().isEmpty()) {
                        parts.add("标签：" + String.join("、", segment.tags()));
                    }
                    for (int i = 0; i < parts.size(); i++) {
                        String text = parts.get(i);
                        /* 空观察没有检索价值：索引空串会让它和任何查询都很像 */
                        if (text.endsWith("：")) continue;
                        docs.add(new SemanticIndex.Doc("reference", segment.id(), i, text));
                    }
                }
            }
        } catch (RuntimeException failed) {
            log.warn("索引参考片失败：{}", failed.getMessage());
        }
        return docs;
    }

    /**
     * capabilities：读 index.json，按条目把 markdown 首段摘成索引文本。
     *
     * <p>不索引 171 MB 的 demo 影片：agent 真正读的是 markdown（风格说明、
     * 镜头卡、组件用法），把 mp4 路径塞进索引只会制造噪音。</p>
     *
     * @return 文档
     */
    private List<SemanticIndex.Doc> fromCapabilities() {
        List<SemanticIndex.Doc> docs = new ArrayList<>();
        if (capabilitiesDir == null || capabilitiesDir.isBlank()) {
            /* 空配置不能静默跳过：索引里可能还留着上一次的条目，
               用户看到「382 条 capability 可搜」，实际这些条目已经和磁盘上的仓库脱节了。
               日志必须说清「本轮一条都没索引」，否则排障时会被误导。 */
            log.info("未配置 capabilities 目录（fengmotion.retrieval.capabilities-dir），"
                    + "本轮不索引任何能力库条目");
            return docs;
        }
        Path root = Path.of(capabilitiesDir);
        if (!Files.isDirectory(root)) {
            log.warn("capabilities 目录不存在，本轮不索引能力库：{}", root);
            return docs;
        }
        try {
            indexStyleDir(root.resolve("lemo-opuscar/styles"), docs);
            indexShotCards(root.resolve("video-shotcraft/references/shots"), docs);
            indexScenes(root.resolve("remotion-scenes/src/scenes"), docs);
        } catch (RuntimeException failed) {
            log.warn("索引 capabilities 失败：{}", failed.getMessage());
        }
        log.info("capabilities 索引条目：{} 段（目录 {}）", docs.size(), root);
        return docs;
    }

    /**
     * lemo 的风格：STYLE.md 正文 + style.json 的元数据。
     *
     * <p>为什么要把 style.json 也拼进去：风格名和分类是最直接的检索入口
     * （用户会说「装饰艺术」或「art deco」），而 STYLE.md 正文多是视觉描述，
     * 未必包含风格自己的名字。</p>
     *
     * @param styles 风格目录
     * @param docs   收集容器
     */
    private void indexStyleDir(Path styles, List<SemanticIndex.Doc> docs) {
        if (!Files.isDirectory(styles)) return;
        try (Stream<Path> dirs = Files.list(styles)) {
            for (Path dir : dirs.toList()) {
                if (!Files.isDirectory(dir)) continue;
                Path style = dir.resolve("STYLE.md");
                if (!Files.isRegularFile(style)) continue;
                String body = excerpt(style, 900);
                if (body.isBlank()) continue;
                String meta = styleMeta(dir.resolve("style.json"));
                docs.add(new SemanticIndex.Doc(KIND_CAPABILITY, "lemo:" + dir.getFileName(), 0,
                        (meta.isBlank() ? "" : meta + " ") + body));
            }
        } catch (IOException unreadable) {
            log.warn("读取 lemo 风格失败：{}", unreadable.getMessage());
        }
    }

    /**
     * 读 {@code style.json} 里对检索有用的字段。
     *
     * <p>字段名不假设固定：不同风格的文件结构可能演进，这里只挑几个常见的
     * 名字（name / title / category / tags / description），取不到就跳过，
     * 绝不因为一个字段缺失让整个风格索引失败。</p>
     */
    private String styleMeta(Path styleJson) {
        if (!Files.isRegularFile(styleJson)) return "";
        try {
            JsonNode node = json.readTree(Files.readString(styleJson, StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (String field : List.of("name", "title", "nameZh", "nameEn", "category", "description")) {
                String value = node.path(field).asText("");
                if (!value.isBlank()) sb.append(value).append(' ');
            }
            JsonNode tags = node.path("tags");
            if (tags.isArray()) {
                for (JsonNode tag : tags) {
                    if (!tag.asText("").isBlank()) sb.append(tag.asText()).append(' ');
                }
            }
            return sb.toString().strip();
        } catch (IOException unreadable) {
            return "";
        }
    }

    /**
     * shotcraft 的镜头卡：每张卡的说明。
     *
     * <p>只收目录下的卡片，跳过 {@code ATTRIBUTION.md} 这类仓库说明文件 ——
     * 它们不是技法，收进来会让「署名与许可」被当成一条可借鉴的镜头配方召回。</p>
     *
     * @param shots 镜头卡目录
     * @param docs  收集容器
     */
    private void indexShotCards(Path shots, List<SemanticIndex.Doc> docs) {
        if (!Files.isDirectory(shots)) return;
        try (Stream<Path> walk = Files.walk(shots, 3)) {
            for (Path file : walk.filter(Files::isRegularFile).toList()) {
                String name = file.getFileName().toString();
                if (!name.endsWith(".md")) continue;
                if (isRepoDoc(name)) continue;
                String text = excerpt(file, 900);
                if (text.isBlank()) continue;
                docs.add(new SemanticIndex.Doc(KIND_CAPABILITY,
                        "shotcraft:" + name.replace(".md", ""), 0, text));
            }
        } catch (IOException unreadable) {
            log.warn("读取 shotcraft 卡失败：{}", unreadable.getMessage());
        }
    }

    /**
     * remotion-scenes 的组件：读组件源码里的注释与参数说明。
     *
     * <p>原实现只把文件名拼成「Remotion 组件 X（分类）」，等于没有内容可检索：
     * 用户说「文字逐字打出来」，文件名 {@code RollerTypewriter} 里的 Typewriter
     * 帮不上忙（何况查询是中文）。实测这类条目 205 条占了 capability 的大头，
     * 却几乎搜不出来。</p>
     *
     * <p>改成读源码：组件顶部的注释/中文说明、{@code export const} 名、
     * 以及 props 里的中文注释，都是真正能描述「这个组件做什么」的文本。
     * 源码本身不整体入库 —— 代码噪声太大，会把真正的语义信号稀释掉。</p>
     *
     * @param scenes 组件目录
     * @param docs   收集容器
     */
    private void indexScenes(Path scenes, List<SemanticIndex.Doc> docs) {
        if (!Files.isDirectory(scenes)) return;
        try (Stream<Path> walk = Files.walk(scenes, 3)) {
            for (Path file : walk.filter(Files::isRegularFile).toList()) {
                String name = file.getFileName().toString();
                if (!name.endsWith(".tsx")) continue;
                /* index.tsx 是导出清单，不是组件；收进来只会制造大量同质条目。 */
                if ("index.tsx".equals(name)) continue;
                String component = name.substring(0, name.length() - 4);
                String category = file.getParent() != null ? file.getParent().getFileName().toString() : "";
                String hint = sourceHints(file);
                docs.add(new SemanticIndex.Doc(KIND_CAPABILITY, "scene:" + component, 0,
                        ("Remotion 组件 " + component + "（分类 " + category + "）"
                                + (hint.isBlank() ? "" : " " + hint)).strip()));
            }
        } catch (IOException unreadable) {
            log.warn("读取 scenes 组件失败：{}", unreadable.getMessage());
        }
    }

    /**
     * 从组件源码里挑出对检索有用的文字。
     *
     * <p>只取注释与标识符：注释通常写着「这是做什么的」（这批组件里大量是日文与英文），
     * 标识符名（如 Roller / Carousel / Glitch）也携带含义，
     * 而完整代码只会把语义信号稀释掉。</p>
     *
     * @param file 组件源码
     * @return 摘要文本；读不出时为空串
     */
    private String sourceHints(Path file) {
        try {
            String raw = Files.readString(file, StandardCharsets.UTF_8);
            StringBuilder sb = new StringBuilder();
            /* 块注释与行注释里的文字。 */
            java.util.regex.Matcher block = java.util.regex.Pattern
                    .compile("/\\*\\*(.*?)\\*/", java.util.regex.Pattern.DOTALL).matcher(raw);
            while (block.find() && sb.length() < 300) {
                String body = block.group(1).replaceAll("(?m)^\\s*\\*\\s?", "").strip();
                if (!body.isBlank()) sb.append(body).append(' ');
            }
            java.util.regex.Matcher line = java.util.regex.Pattern
                    .compile("//\\s*(.+)").matcher(raw);
            while (line.find() && sb.length() < 400) {
                sb.append(line.group(1).strip()).append(' ');
            }
            /* 组件名再按驼峰拆成词，补足注释缺失的情况（RollerTypewriter → Roller Typewriter）。 */
            String component = file.getFileName().toString().replace(".tsx", "");
            String words = component.replaceAll("([a-z0-9])([A-Z])", "$1 $2");
            if (!words.equals(component)) sb.append(words);
            String out = sb.toString().replaceAll("\\s+", " ").strip();
            return out.length() > 400 ? out.substring(0, 400) : out;
        } catch (IOException unreadable) {
            return "";
        }
    }

    /**
     * 是否是仓库级说明文件（署名、许可、索引），而不是可借鉴的技法卡片。
     */
    private static boolean isRepoDoc(String fileName) {
        String lower = fileName.toLowerCase(java.util.Locale.ROOT);
        return lower.startsWith("readme")
                || lower.startsWith("attribution")
                || lower.startsWith("license")
                || lower.startsWith("changelog")
                || lower.startsWith("contributing");
    }

    /**
     * 取 markdown 的有效开头：跳过 front matter 与标题行，留正文。
     *
     * @param file  文件
     * @param limit 字符上限
     * @return 摘录
     */
    private String excerpt(Path file, int limit) {
        try {
            String raw = Files.readString(file, StandardCharsets.UTF_8);
            String body = raw.replaceAll("(?s)^---.*?---\\s*", "");
            StringBuilder sb = new StringBuilder();
            for (String line : body.split("\n")) {
                String trimmed = line.strip();
                if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;
                sb.append(trimmed).append(' ');
                if (sb.length() >= limit) break;
            }
            String name = file.getParent() != null ? file.getParent().getFileName().toString() : "";
            String out = sb.length() > limit ? sb.substring(0, limit) : sb.toString();
            return (name + " " + out).strip();
        } catch (IOException unreadable) {
            return "";
        }
    }

    /**
     * 参考片全量查询。
     *
     * @return 查询对象
     */
    private ReferenceRepository.VideoQuery videoQuery() {
        return new ReferenceRepository.VideoQuery(null, null, null, 10000, 0);
    }

    private String safe(String text) {
        return text == null ? "" : text;
    }
}
