package com.fengmotion.server.fx.service.capability;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * 没有 front matter 的普通 markdown —— 最后一道兜底。
 *
 * <p>有些技能库用纯 markdown：标题当名字，第一段当说明，没有元数据块。
 * 这类文件如果没人认，整个库就一条都导不进来。这里用最小规则把它们接住：
 * 用第一个一级/二级标题当名字，第一段正文当说明。</p>
 *
 * <p><strong>为什么要限制范围</strong>：如果什么 md 都收，会得到大量
 * 「第 1 章」「注意事项」这种条目，把特效库冲垮。所以这里额外要求
 * 文件本身像一个「独立条目」：有一个不超过 60 字的标题，且有正文段落。
 * 仍不满足的，如实记为跳过。</p>
 */
@Component
@Order(100)
public class GenericMarkdownSource implements CapabilitySource {

    /** 标题长度上限：太长的标题多半是段落误判成标题。 */
    private static final int MAX_TITLE_LENGTH = 60;

    private final FrontMatterSource frontMatter;

    public GenericMarkdownSource(FrontMatterSource frontMatter) {
        this.frontMatter = frontMatter;
    }

    @Override
    public String kind() {
        return "generic-markdown";
    }

    @Override
    public boolean supports(Path file) {
        String name = file.getFileName().toString().toLowerCase(java.util.Locale.ROOT);
        if (!name.endsWith(".md")) {
            return false;
        }
        /* 带 front matter 的交给 FrontMatterSource，不在这里重复处理：
           否则同一个文件会被两个解析器各收一次，产生重复条目。 */
        return !hasFrontMatter(file);
    }

    @Override
    public List<ParsedItem> parse(Path file, Path scanRoot) throws IOException {
        String raw = Files.readString(file, StandardCharsets.UTF_8);
        String title = firstTitle(raw);
        String body = firstParagraph(raw);
        if (title.isBlank() || title.length() > MAX_TITLE_LENGTH || body.isBlank()
                || !CapabilitySource.looksLikeEntryName(title)
                /* 流程/方法论文档也走这条兜底路径（它们没有 front matter，
                   只有标题）。实测：不过滤时 shotcraft 的 pipeline、aesthetic-rules、
                   publish-upload-post 等 10 篇流程文档会被当成技法收进来。 */
                || FrontMatterSource.looksLikeProcessDoc(title, body)) {
            /* 不像一个独立条目：交给调用方记为跳过。
               这里返回空列表而不是抛错 —— 这是「认得出但没内容可收」，
               与「格式坏了」是两回事。 */
            return List.of();
        }
        Path parent = file.getParent();
        String categoryHint = (parent != null && parent.getFileName() != null
                && !parent.equals(scanRoot)) ? parent.getFileName().toString() : "";

        return List.of(new ParsedItem(
                (scanRoot.getFileName() == null ? "md-" : scanRoot.getFileName() + "-")
                        + FrontMatterSource.slug(title),
                title,
                "",
                body,
                categoryHint,
                List.of(),
                List.of(),
                List.of(),
                "",
                scanRoot.getFileName() == null ? "" : scanRoot.getFileName().toString(),
                "",
                "",
                "",
                "",
                "",
                scanRoot.relativize(file).toString()));
    }

    private static boolean hasFrontMatter(Path file) {
        try (var reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            String first = reader.readLine();
            return first != null && first.strip().equals("---");
        } catch (IOException unreadable) {
            return false;
        }
    }

    private static String firstTitle(String raw) {
        for (String line : raw.split("\n")) {
            String trimmed = line.strip();
            if (trimmed.startsWith("# ")) {
                return trimmed.substring(2).strip();
            }
        }
        for (String line : raw.split("\n")) {
            String trimmed = line.strip();
            if (trimmed.startsWith("## ")) {
                return trimmed.substring(3).strip();
            }
        }
        return "";
    }

    private static String firstParagraph(String raw) {
        for (String block : raw.split("\n\n")) {
            String trimmed = block.strip();
            if (trimmed.isEmpty() || trimmed.startsWith("#") || trimmed.startsWith("|")
                    || trimmed.startsWith("```") || trimmed.startsWith(">")) {
                continue;
            }
            return trimmed.length() > 400 ? trimmed.substring(0, 400) : trimmed;
        }
        return "";
    }
}
