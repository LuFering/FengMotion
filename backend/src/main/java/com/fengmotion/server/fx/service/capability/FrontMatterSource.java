package com.fengmotion.server.fx.service.capability;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.springframework.stereotype.Component;

/**
 * 带 front matter 的 markdown（video-shotcraft 的镜头卡就是这种）。
 *
 * <p><strong>这个解析器是通用兜底的主力</strong>：绝大多数技能库用
 * 「一页 markdown = 一个条目」的结构，开头一段 {@code ---} 放元数据。
 * 只要遵守这个约定，新库不用改代码就能导入。</p>
 *
 * <p>键名不写死：中文键（{@code 一句话}、{@code 适用}、{@code 时长}）与英文键
 * （{@code name}、{@code description}、{@code summary}、{@code tags}）都按候选列表试。
 * 同一概念在不同库里叫不同名字是常态，要求统一键名等于拒绝接入。</p>
 */
@Component
public class FrontMatterSource implements CapabilitySource {

    /** 标题字段候选，按优先级。 */
    private static final List<String> NAME_KEYS =
            List.of("name", "title", "名称", "标题", "标题名");
    /** 一句话说明候选。 */
    private static final List<String> INTENT_KEYS =
            List.of("一句话", "description", "summary", "简介", "说明", "intent", "用途");
    /** 分类候选。 */
    private static final List<String> CATEGORY_KEYS =
            List.of("category", "分类", "type", "类型", "group");
    /** 适用场合候选。 */
    private static final List<String> SCENE_KEYS =
            List.of("适用", "适用场景", "scenes", "use", "when", "when_to_use");
    /** 关键词候选。 */
    private static final List<String> TAG_KEYS =
            List.of("tags", "keywords", "标签", "关键词");

    @Override
    public String kind() {
        return "md";
    }

    @Override
    public boolean supports(Path file) {
        String name = file.getFileName().toString().toLowerCase(java.util.Locale.ROOT);
        if (!name.endsWith(".md")) {
            return false;
        }
        /* 只认带 front matter 的：没有元数据的 md 大多是说明文档，
           收进特效库只会得到一堆名叫「第 1 章」的条目。
           纯说明文档由 GenericMarkdownSource 处理（它要求有标题级别）。 */
        return startsWithFrontMatter(file);
    }

    @Override
    public List<ParsedItem> parse(Path file, Path scanRoot) throws IOException {
        String raw = Files.readString(file, StandardCharsets.UTF_8);
        Map<String, String> meta = readFrontMatter(raw);
        if (meta.isEmpty()) {
            return List.of();
        }

        String name = firstOf(meta, NAME_KEYS);
        if (!name.isBlank() && !CapabilitySource.looksLikeEntryName(name)) {
            /* front matter 里的名字不可用：宁可跳过，也不要用 "L3" 这种
               名字建条目 —— 它会让整个列表像数据损坏。 */
            return List.of();
        }
        if (name.isBlank()) {
            /* 没有名字时退回文件名：文件名总比「未命名」有信息量，
               但去掉扩展名，避免出现「xxx.md」这种条目名。 */
            name = file.getFileName().toString().replaceFirst("(?i)\\.md$", "");
        }
        String intent = firstOf(meta, INTENT_KEYS);
        if (intent.isBlank()) {
            intent = firstParagraph(raw);
        }

        /* 只收「可以借鉴的东西」，不收方法论章节。
           实测：shotcraft 的 references/ 下有 pipeline、music-beat-sync、
           publish-upload-post 这类流程文档，它们也有 front matter 和标题，
           会被正常收进来 —— 但用户要的是「怎么做这个效果」，
           不是「发布到社交平台的步骤」。这类条目的标题往往是流程名，
           特征是名字里带「流程/流水线/发布/准则」这类词。
           判断放在解析层而不是目录层：换一个库，分类目录名可能完全不同。 */
        if (looksLikeProcessDoc(name, intent)) {
            return List.of();
        }

        String categoryHint = firstOf(meta, CATEGORY_KEYS);
        if (categoryHint.isBlank()) {
            /* 没有显式分类时，用上一级目录名当提示：
               常见布局是 shots/camera/xxx.md，目录名就是分类。 */
            Path parent = file.getParent();
            if (parent != null && parent.getFileName() != null && !parent.equals(scanRoot)) {
                categoryHint = parent.getFileName().toString();
            }
        }

        List<String> keywords = new ArrayList<>(splitList(firstOf(meta, TAG_KEYS)));
        String sourcePath = scanRoot.relativize(file).toString();

        return List.of(new ParsedItem(
                /* ID 前缀用来源项目名 + 文件名，避免两个库有同名卡片时互相覆盖。
                   同一库内重名的情况用扫描根名区分，比加随机后缀更稳定 —— 
                   重复导入时同一个文件必须得到同一个 ID，否则会不断堆新条目。 */
                idPrefix(scanRoot) + slug(name),
                name,
                "",
                intent,
                categoryHint,
                splitList(firstOf(meta, SCENE_KEYS)),
                keywords,
                List.of(),
                "",
                scanRoot.getFileName() == null ? "" : scanRoot.getFileName().toString(),
                repoUrl(scanRoot),
                firstOf(meta, List.of("version", "版本")),
                licenseFrom(scanRoot, "CODE"),
                licenseFrom(scanRoot, "PREVIEW"),
                licenseFrom(scanRoot, "ATTRIBUTION"),
                sourcePath));
    }

    private static String idPrefix(Path scanRoot) {
        Path name = scanRoot.getFileName();
        return name == null ? "md-" : name.toString() + "-";
    }

    /** 名字转成稳定 ID 片段：保留字母数字与中文，其余换成短横。 */
    static String slug(String name) {
        String s = name.strip().toLowerCase(java.util.Locale.ROOT)
                .replaceAll("[^\\p{IsAlphabetic}\\p{IsDigit}]+", "-")
                .replaceAll("^-+|-+$", "");
        return s.isEmpty() ? "item" : s;
    }

    private static String repoUrl(Path scanRoot) {
        Path name = scanRoot.getFileName();
        return name == null ? "" : "https://github.com/vincentwei1021/" + name;
    }

    private static String licenseFrom(Path root, String key) {
        for (String name : List.of("LICENSE", "LICENSE.md", "NOTICE", "NOTICE.md", "README.md")) {
            Path file = root.resolve(name);
            if (!Files.isRegularFile(file)) {
                continue;
            }
            try {
                for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                    String trimmed = line.strip();
                    if (trimmed.startsWith(key + ":")) {
                        return trimmed.substring(trimmed.indexOf(':') + 1).strip();
                    }
                }
            } catch (IOException unreadable) {
                // 读不到就当没有
            }
        }
        return "";
    }

    private static String firstOf(Map<String, String> meta, List<String> keys) {
        for (String key : keys) {
            String value = meta.get(key);
            if (value != null && !value.isBlank()) {
                return value.strip();
            }
        }
        return "";
    }

    /** 逗号/顿号/分号分隔的列表。 */
    static List<String> splitList(String value) {
        if (value == null || value.isBlank()) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (String part : value.split("[,，、;；]")) {
            String trimmed = part.strip();
            if (!trimmed.isEmpty()) {
                out.add(trimmed);
            }
        }
        return out;
    }

    private static boolean startsWithFrontMatter(Path file) {
        try (var reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            String first = reader.readLine();
            return first != null && first.strip().equals("---");
        } catch (IOException unreadable) {
            return false;
        }
    }

    /**
     * 读 front matter 的键值对。
     *
     * <p>只支持「单行值」这一种写法：嵌套 YAML（列表、对象）在技能库里很少见，
     * 为它引入一个 YAML 解析器不划算。遇到嵌套结构时该键的值会变成空串，
     * 条目仍然能导入，只是少了那个字段 —— 比整个文件失败要好。</p>
     */
    public static Map<String, String> readFrontMatter(String raw) {
        Map<String, String> meta = new LinkedHashMap<>();
        if (raw == null || !raw.startsWith("---")) {
            return meta;
        }
        Matcher m = Pattern.compile("^---\\R(.*?)\\R---\\s*$", Pattern.DOTALL | Pattern.MULTILINE).matcher(raw);
        if (!m.find()) {
            /* 结尾没有 --- 时退化成「读到文件末尾」，仍然尽量取到元数据，
               而不是整条丢弃。 */
            String rest = raw.substring(3);
            parseLines(rest.split("\n"), meta);
            return meta;
        }
        parseLines(m.group(1).split("\n"), meta);
        return meta;
    }

    private static void parseLines(String[] lines, Map<String, String> meta) {
        for (String line : lines) {
            if (line.isBlank() || line.stripLeading().startsWith("#")) {
                continue;
            }
            int colon = line.indexOf(':');
            if (colon <= 0) {
                continue;
            }
            String key = line.substring(0, colon).strip();
            String value = line.substring(colon + 1).strip();
            /* 去掉包裹引号：YAML 里 "xxx" 和 xxx 等价，
               留着引号会让条目名显示成 "xxx"。 */
            if (value.length() >= 2
                    && ((value.startsWith("\"") && value.endsWith("\""))
                        || (value.startsWith("'") && value.endsWith("'")))) {
                value = value.substring(1, value.length() - 1);
            }
            if (!key.isEmpty() && !value.isEmpty()) {
                meta.putIfAbsent(key, value);
            }
        }
    }

    /** 正文第一个非标题段落，作为没有一句话说明时的兜底。 */
    private static String firstParagraph(String raw) {
        String body = raw.replaceFirst("(?s)^---.*?\\R---\\s*", "");
        for (String block : body.split("\n\n")) {
            String trimmed = block.strip();
            if (trimmed.isEmpty() || trimmed.startsWith("#") || trimmed.startsWith("|")
                    || trimmed.startsWith("```")) {
                continue;
            }
            return trimmed.length() > 400 ? trimmed.substring(0, 400) : trimmed;
        }
        return "";
    }

    /** 保留给测试：列出扫描目录下的全部候选文件。 */
    static List<Path> markdownFiles(Path root) throws IOException {
        try (Stream<Path> walk = Files.walk(root, 6)) {
            return walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().toLowerCase(java.util.Locale.ROOT).endsWith(".md"))
                    .toList();
        }
    }

    /**
     * 名字或说明看起来像「流程/方法论」而不是「可借鉴的手法」。
     *
     * <p>规则保守：只拦明确的流程词，避免把「运镜流程」这种其实是技法的条目也拦掉。
     * 拿不准就放过 —— 多收一条的边缘条目，比漏掉一条真技法要好。</p>
     */
    static boolean looksLikeProcessDoc(String name, String intent) {
        String n = (name == null ? "" : name).toLowerCase(java.util.Locale.ROOT);
        for (String word : List.of("流水线", "pipeline", "发布", "upload", "导引", "guided",
                "终检", "final-review", "准则", "rules", "工作台", "workbench",
                "共同创作", "导出", "export", "方法",
                "声音设计", "sound-design", "序列", "sequence")) {
            if (n.contains(word)) {
                return true;
            }
        }
        return false;
    }
}
