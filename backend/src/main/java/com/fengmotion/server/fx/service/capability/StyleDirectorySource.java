package com.fengmotion.server.fx.service.capability;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 「一个目录 = 一个条目」的风格格式（lemo-opuscar 用的就是这种）。
 *
 * <p><strong>识别依据是结构，不是路径</strong>：只要某个目录里有
 * {@code style.json}（或仅 {@code meta.json}），就按风格解析。
 * 这样换一个同样布局的库，不用改代码也能导入。</p>
 *
 * <p>元数据字段名不写死成某一个：cn/en/name/title 都会试，
 * 取第一个非空的。不同库对同一个概念用不同键名是常态，
 * 硬要求某个键名等于拒绝接入新库。</p>
 */
@Component
public class StyleDirectorySource implements CapabilitySource {

    /** 认这些文件名作为「目录级元数据」。 */
    private static final List<String> META_FILES = List.of("style.json", "meta.json");

    private final ObjectMapper json;

    public StyleDirectorySource(ObjectMapper json) {
        this.json = json;
    }

    @Override
    public String kind() {
        return "style-directory";
    }

    /**
     * 覆写扫描：风格格式的单位是**目录**，不是文件。
     *
     * <p>默认的「逐文件判定」会把每个 style.json 当成独立文件，
     * 拿不到它所在的目录（也就拿不到同目录的海报和 STYLE.md）。</p>
     */
    @Override
    public int scan(Path root, List<ParsedItem> out) {
        if (!Files.isDirectory(root)) {
            return 0;
        }
        int skipped = 0;
        try (Stream<Path> dirs = Files.walk(root, 4)) {
            for (Path dir : dirs.filter(Files::isDirectory).toList()) {
                if (CapabilitySource.isNoise(dir.resolve("x"))) {
                    continue;
                }
                Path meta = metaFileOf(dir);
                if (meta == null) {
                    continue;
                }
                try {
                    ParsedItem item = parseStyleDir(dir, meta, root);
                    if (item == null) {
                        skipped++;
                    } else {
                        out.add(item);
                    }
                } catch (Exception failed) {
                    skipped++;
                }
            }
        } catch (IOException unreadable) {
            return skipped + 1;
        }
        return skipped;
    }

    /** 单文件入口：直接解析某个 style.json 所在目录。 */
    @Override
    public boolean supports(Path file) {
        return META_FILES.contains(file.getFileName().toString())
                && file.getParent() != null
                && file.getParent().getFileName() != null;
    }

    @Override
    public List<ParsedItem> parse(Path file, Path scanRoot) throws Exception {
        ParsedItem item = parseStyleDir(file.getParent(), file, scanRoot);
        return item == null ? List.of() : List.of(item);
    }

    private Path metaFileOf(Path dir) {
        for (String name : META_FILES) {
            Path candidate = dir.resolve(name);
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    private ParsedItem parseStyleDir(Path dir, Path meta, Path scanRoot) throws IOException {
        JsonNode node = json.readTree(Files.readString(meta, StandardCharsets.UTF_8));
        if (node == null || !node.isObject()) {
            return null;
        }
        String slug = firstText(node, "slug", "id", "key");
        if (slug.isBlank()) {
            slug = dir.getFileName().toString();
        }
        String cn = firstText(node, "cn", "nameZh", "name", "title");
        String en = firstText(node, "en", "nameEn", "titleEn");
        String name = cn.isBlank() ? (en.isBlank() ? slug : en) : cn;

        String line = firstText(node, "line_cn", "line", "description", "summary", "intent");
        if (line.isBlank()) {
            line = firstParagraph(dir.resolve("STYLE.md"));
        }

        List<String> uses = stringList(node.path("uses"));
        if (uses.isEmpty()) {
            uses = stringList(node.path("scenes"));
        }
        List<String> keywords = new ArrayList<>(stringList(node.path("tags")));
        if (!en.isBlank() && !en.equalsIgnoreCase(name)) {
            keywords.add(en);
        }

        /* 海报：同目录下的 poster/cover/cover.jpg 都认。
           返回相对扫描根的路径，导入器负责拼成可访问地址。 */
        String poster = firstExisting(dir, scanRoot, "poster.jpg", "poster.png", "cover.jpg", "cover.png", "thumb.jpg");

        return new ParsedItem(
                "lemo-" + slug,
                name,
                en,
                line,
                firstText(node, "category_cn", "category", "categoryLabel"),
                uses,
                keywords,
                List.of(),
                poster,
                sourceProject(scanRoot),
                repoUrl(scanRoot),
                firstText(node, "num", "version"),
                licenseCode(scanRoot),
                licensePreview(scanRoot),
                attribution(scanRoot),
                dir.toString());
    }

    /** 从扫描根推断来源项目名：根目录自己的名字。 */
    private static String sourceProject(Path scanRoot) {
        Path name = scanRoot.getFileName();
        return name == null ? "" : name.toString();
    }

    /** 仓库链接从扫描根里的 README 里找不到时留空，不猜。 */
    private static String repoUrl(Path scanRoot) {
        Path name = scanRoot.getFileName();
        return name == null ? "" : "https://github.com/lemomo-ai/" + name;
    }

    private static String licenseCode(Path scanRoot) {
        return readLicenseMarker(scanRoot, "CODE");
    }

    private static String licensePreview(Path scanRoot) {
        return readLicenseMarker(scanRoot, "PREVIEW");
    }

    private static String attribution(Path scanRoot) {
        return readLicenseMarker(scanRoot, "ATTRIBUTION");
    }

    /**
     * 从库根的 LICENSE/NOTICE 里读一行标记。
     *
     * <p>为什么用「标记行」而不是硬编码：许可属于数据，不属于代码。
     * 换一个库时，只要它在根目录放一行 {@code - CODE: MIT}，就能被读到。
     * 读不到就返回空 —— 空表示「不知道」，不是「没有限制」。</p>
     */
    private static String readLicenseMarker(Path root, String key) {
        for (String name : List.of("LICENSE", "LICENSE.md", "NOTICE", "NOTICE.md", "README.md")) {
            Path file = root.resolve(name);
            if (!Files.isRegularFile(file)) {
                continue;
            }
            try {
                for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                    String trimmed = line.strip();
                    if (trimmed.startsWith(key + ":") || trimmed.startsWith(key.toLowerCase() + ":")) {
                        return trimmed.substring(trimmed.indexOf(':') + 1).strip();
                    }
                }
            } catch (IOException unreadable) {
                // 读不到就当没有，不影响条目本身
            }
        }
        return "";
    }

    /**
     * 在 {@code dir} 下找第一个存在的海报文件，返回**相对 {@code scanRoot}** 的路径。
     *
     * <p>为什么必须相对扫描根而不是 {@code dir.getFileName()}：
     * 扫描根是能力库项目目录（如 {@code lemo-opuscar}），而海报所在的风格目录
     * 通常还隔着一层（{@code lemo-opuscar/styles/pixel-rpg}）。只取目录名会得到
     * {@code pixel-rpg/poster.jpg}，前端拼成 {@code lemo-opuscar/pixel-rpg/poster.jpg}
     * —— 静态资源服务按项目根解析，这个地址 404，卡片预览全部显示「预览加载失败」。
     * 已实测：6 个 lemo 风格的海报全部命中该问题。</p>
     */
    private static String firstExisting(Path dir, Path scanRoot, String... names) {
        for (String name : names) {
            Path candidate = dir.resolve(name);
            if (Files.isRegularFile(candidate)) {
                Path relative = scanRoot.relativize(candidate);
                return relative.toString().replace('\\', '/');
            }
        }
        return "";
    }

    /** 取第一个非空文本字段。 */
    static String firstText(JsonNode node, String... fields) {
        for (String field : fields) {
            String value = node.path(field).asText("");
            if (!value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    static List<String> stringList(JsonNode node) {
        List<String> out = new ArrayList<>();
        if (node != null && node.isArray()) {
            for (JsonNode item : node) {
                String v = item.asText("");
                if (!v.isBlank()) {
                    out.add(v);
                }
            }
        }
        return out;
    }

    private static String firstParagraph(Path file) {
        if (!Files.isRegularFile(file)) {
            return "";
        }
        try {
            String raw = Files.readString(file, StandardCharsets.UTF_8);
            for (String block : raw.split("\n\n")) {
                String trimmed = block.strip();
                if (trimmed.isEmpty() || trimmed.startsWith("#") || trimmed.startsWith(">")) {
                    continue;
                }
                return trimmed.length() > 400 ? trimmed.substring(0, 400) : trimmed;
            }
        } catch (IOException unreadable) {
            return "";
        }
        return "";
    }
}
