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
        if (capabilitiesDir == null || capabilitiesDir.isBlank()) return docs;
        Path root = Path.of(capabilitiesDir);
        if (!Files.isDirectory(root)) {
            log.debug("capabilities 目录不存在：{}", root);
            return docs;
        }
        try {
            indexStyleDir(root.resolve("lemo-opuscar/styles"), docs);
            indexShotCards(root.resolve("video-shotcraft/references/shots"), docs);
            indexScenes(root.resolve("remotion-scenes/src/scenes"), docs);
        } catch (RuntimeException failed) {
            log.warn("索引 capabilities 失败：{}", failed.getMessage());
        }
        log.info("capabilities 索引条目：{} 段", docs.size());
        return docs;
    }

    /**
     * lemo 的 51 个风格：每个 STYLE.md 的前几段。
     *
     * @param styles 风格目录
     * @param docs   收集容器
     */
    private void indexStyleDir(Path styles, List<SemanticIndex.Doc> docs) {
        if (!Files.isDirectory(styles)) return;
        try (Stream<Path> dirs = Files.list(styles)) {
            for (Path dir : dirs.toList()) {
                Path style = dir.resolve("STYLE.md");
                if (!Files.isRegularFile(style)) continue;
                String text = excerpt(style, 700);
                if (text.isBlank()) continue;
                docs.add(new SemanticIndex.Doc(KIND_CAPABILITY, "lemo:" + dir.getFileName(), 0, text));
            }
        } catch (IOException unreadable) {
            log.warn("读取 lemo 风格失败：{}", unreadable.getMessage());
        }
    }

    /**
     * shotcraft 的镜头卡：每张卡的说明。
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
                String text = excerpt(file, 600);
                if (text.isBlank()) continue;
                docs.add(new SemanticIndex.Doc(KIND_CAPABILITY,
                        "shotcraft:" + file.getFileName().toString().replace(".md", ""), 0, text));
            }
        } catch (IOException unreadable) {
            log.warn("读取 shotcraft 卡失败：{}", unreadable.getMessage());
        }
    }

    /**
     * remotion-scenes 的组件：按目录名建索引（组件本身没有说明文档）。
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
                docs.add(new SemanticIndex.Doc(KIND_CAPABILITY,
                        "scene:" + name.replace(".tsx", ""), 0,
                        "Remotion 组件 " + name.replace(".tsx", "") + "（" + file.getParent().getFileName() + "）"));
            }
        } catch (IOException unreadable) {
            log.warn("读取 scenes 组件失败：{}", unreadable.getMessage());
        }
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
