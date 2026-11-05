package com.fengmotion.server.fx.service.capability;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 通用 JSON 条目：文件里是单个对象，或对象数组。
 *
 * <p>兜底层。只要 JSON 里有能当名字的字段（name/title/id 任一），
 * 就当作一个（或一批）条目收下，其余字段能找到就用、找不到就留空。</p>
 *
 * <p>为什么不要求固定 schema：不同库的 JSON 结构差异很大，
 * 为每一种写一个解析器不现实。这里的原则是「能取多少取多少，
 * 取不到就空着」—— 空着表示不知道，界面不会补默认文案。</p>
 */
@Component
@Order(90)
public class GenericJsonSource implements CapabilitySource {

    /** 名字候选。 */
    private static final List<String> NAME_KEYS = List.of("name", "title", "slug", "id", "cn", "en");
    /** 说明候选。 */
    private static final List<String> INTENT_KEYS =
            List.of("description", "desc", "summary", "intent", "line", "line_cn", "一句话");
    /** 分类候选。 */
    private static final List<String> CATEGORY_KEYS = List.of("category", "type", "group", "分类");

    private final ObjectMapper json;

    public GenericJsonSource(ObjectMapper json) {
        this.json = json;
    }

    @Override
    public String kind() {
        return "generic-json";
    }

    @Override
    public boolean supports(Path file) {
        String name = file.getFileName().toString().toLowerCase(java.util.Locale.ROOT);
        if (!name.endsWith(".json")) {
            return false;
        }
        /* style.json / meta.json 已经由 StyleDirectorySource 按目录处理。
           这里必须排除，否则同一份元数据会被收成两条：一条来自目录级解析
           （带海报、STYLE.md），一条来自这个兜底（字段更少）。
           两条 ID 不同，用户会在列表里看到重复的风格。 */
        return !name.equals("style.json") && !name.equals("meta.json");
    }

    @Override
    public List<ParsedItem> parse(Path file, Path scanRoot) throws IOException {
        JsonNode root = json.readTree(Files.readString(file, StandardCharsets.UTF_8));
        if (root == null) {
            return List.of();
        }
        List<ParsedItem> out = new ArrayList<>();
        if (root.isArray()) {
            for (JsonNode node : root) {
                ParsedItem item = toItem(node, file, scanRoot);
                if (item != null) {
                    out.add(item);
                }
            }
        } else if (root.isObject()) {
            ParsedItem item = toItem(root, file, scanRoot);
            if (item != null) {
                out.add(item);
            }
        }
        return out;
    }

    private ParsedItem toItem(JsonNode node, Path file, Path scanRoot) {
        String name = firstText(node, NAME_KEYS);
        if (name.isBlank()) {
            /* 没有名字的 JSON 多半是配置或索引文件，不是条目。 */
            return null;
        }
        if (!CapabilitySource.looksLikeEntryName(name)) {
            /* 名如 "L1"、"5.4" 的多是台词行、音乐提示点这类数据记录，
               不是可以借鉴的技法。 */
            return null;
        }
        String project = scanRoot.getFileName() == null ? "" : scanRoot.getFileName().toString();
        return new ParsedItem(
                project + "-" + FrontMatterSource.slug(name),
                name,
                firstText(node, List.of("en", "nameEn", "titleEn")),
                firstText(node, INTENT_KEYS),
                firstText(node, CATEGORY_KEYS),
                stringList(node.path("uses")),
                stringList(node.path("tags")),
                List.of(),
                "",
                project,
                "",
                firstText(node, List.of("version", "num")),
                "",
                "",
                "",
                scanRoot.relativize(file).toString());
    }

    private static String firstText(JsonNode node, List<String> keys) {
        for (String key : keys) {
            String value = node.path(key).asText("");
            if (!value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private static List<String> stringList(JsonNode node) {
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
}
