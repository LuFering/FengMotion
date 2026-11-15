package com.fengmotion.server.fx.service.capability;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

/**
 * 从 TypeScript/React 源码里发现组件候选（纯规则，不用模型）。
 *
 * <p><strong>为什么需要这个解析器</strong>：remotion-scenes 的 204 个组件
 * 没有任何元数据文件，只有 {@code .tsx} 源码。既有解析器都认不出来，
 * 所以这批组件在特效库里一直是「搜得到、点不进去」。</p>
 *
 * <p><strong>它只提取能确定的事实</strong>：组件名、props 名与默认值、
 * 外部依赖、用到的 Remotion API、代码行数、首块注释原文。
 * 中文名与用途<em>不在这里生成</em> —— 那是模型的工作，
 * 而且必须经过校验（见 {@code docs/research/scene-source-import.md}）。</p>
 *
 * <p><strong>为什么不用真正的 AST 解析器</strong>：一批组件是 200 个文件、
 * 一次性扫描，用正则提取已经实测覆盖 204/204。引入 TypeScript 编译器
 * 意味着多一个重型依赖与构建期 Node 进程，而收益只是更强的语法健壮性 ——
 * 在「提取组件名和 props 名」这种极稳定的写法上不划算。
 * 如果将来遇到解析不了的新写法，{@link #parse} 会如实返回空，不会硬凑。</p>
 */
@Component
public class TsxComponentSource implements CapabilitySource {

    /** 组件导出：{@code export const Name = ({ ... }: { ... }) =>}。 */
    private static final Pattern EXPORT = Pattern.compile(
            "export\\s+const\\s+([A-Za-z0-9_]+)\\s*=\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*:\\s*\\{([\\s\\S]*?)\\}\\s*\\)",
            Pattern.MULTILINE);

    /** props 解构里的 {@code name = default}。 */
    private static final Pattern PROP = Pattern.compile("([A-Za-z0-9_]+)\\s*(?:=\\s*([^,}\\n]+))?");

    /** 首块文档注释。 */
    private static final Pattern DOC_BLOCK = Pattern.compile("/\\*\\*([\\s\\S]*?)\\*/");

    /** import 语句的来源。 */
    private static final Pattern IMPORT = Pattern.compile("import\\s+[^'\"]*from\\s+['\"]([^'\"]+)['\"]");

    /** 值得记录的 Remotion API，用来判断这个组件依赖哪个运行能力。 */
    private static final List<String> REMOTION_APIS = List.of(
            "useCurrentFrame", "useVideoConfig", "interpolate", "spring",
            "Sequence", "AbsoluteFill", "Audio", "random", "Easing");

    @Override
    public String kind() {
        return "tsx-component";
    }

    @Override
    public boolean supports(Path file) {
        String name = file.getFileName().toString().toLowerCase(java.util.Locale.ROOT);
        /* index.tsx 是导出清单，不是组件。收进来会产生大量名为 index 的条目，
           实测过：不排除时 13 个 index 全部被当成组件。 */
        return name.endsWith(".tsx") && !name.equals("index.tsx");
    }

    @Override
    public List<ParsedItem> parse(Path file, Path scanRoot) throws IOException {
        String source = Files.readString(file, StandardCharsets.UTF_8);
        Matcher export = EXPORT.matcher(source);
        if (!export.find()) {
            /* 认得出是 .tsx，但不是「导出单个组件」的写法。
               返回空 → 记为跳过，而不是编一个组件名。 */
            return List.of();
        }
        String component = export.group(1);
        if (!CapabilitySource.looksLikeEntryName(component)) {
            return List.of();
        }

        List<String> props = new ArrayList<>();
        Matcher prop = PROP.matcher(export.group(2));
        while (prop.find()) {
            if (prop.group(1) != null) {
                props.add(prop.group(1));
            }
        }

        String relative = scanRoot.relativize(file).toString().replace('\\', '/');
        String category = topDirectory(relative);

        /* 「用途」字段暂时留空：模型没跑之前，这里不该有内容。
           原注释放进 steps，作为可追溯的原始依据 —— 用户能看到
           「这条的日文原注释是什么」，将来模型翻错了也能对照。 */
        List<String> steps = new ArrayList<>();
        String doc = firstDocLine(source);
        if (!doc.isBlank()) {
            steps.add("源码注释：" + doc);
        }
        if (!props.isEmpty()) {
            steps.add("可调参数：" + String.join("、", props));
        }
        List<String> apis = new ArrayList<>();
        for (String api : REMOTION_APIS) {
            if (source.contains(api)) {
                apis.add(api);
            }
        }
        if (!apis.isEmpty()) {
            steps.add("使用 API：" + String.join("、", apis));
        }
        steps.add("__SOURCE_CODE__:\n" + source);

        return List.of(new ParsedItem(
                /* ID 用「来源-组件名」：组件名在库内唯一，加上来源前缀避免跨库撞名。
                   不用文件路径做 ID —— 移动文件目录时 ID 会变，用户收藏就丢了。 */
                scanRootOf(scanRoot) + "-" + component,
                /* 名字先用组件名：这是确定的事实。中文名等模型补，
                   没补之前显示英文字面值，比编一个中文名诚实。 */
                component,
                "",
                "",
                category,
                List.of(),
                keywords(component, category),
                steps,
                "",
                scanRootOf(scanRoot),
                "",
                "",
                "",
                "",
                "",
                relative));
    }

    /** 依赖信息：单独提供给上层判断「能不能运行」。 */
    public Set<String> externalDependencies(Path file) throws IOException {
        String source = Files.readString(file, StandardCharsets.UTF_8);
        Set<String> deps = new LinkedHashSet<>();
        Matcher m = IMPORT.matcher(source);
        while (m.find()) {
            String spec = m.group(1);
            if (!spec.startsWith(".")) {
                deps.add(spec);
            }
        }
        return deps;
    }

    /**
     * 首块注释里「组件名 - 描述」的那行描述。
     *
     * <p>多数组件写的是日文（199/204），这里原样保留，不翻译 ——
     * 翻译是模型的事，规则层只负责把原文带出来。</p>
     */
    static String firstDocLine(String source) {
        Matcher block = DOC_BLOCK.matcher(source);
        if (!block.find()) {
            return "";
        }
        String first = "";
        for (String line : block.group(1).split("\n")) {
            String trimmed = line.replaceAll("^\\s*\\*\\s?", "").strip();
            if (trimmed.isEmpty()) {
                continue;
            }
            Matcher named = Pattern.compile("^[A-Za-z0-9_]+\\s*[-–—]\\s*(.+)$").matcher(trimmed);
            if (named.matches()) {
                return named.group(1).strip();
            }
            if (first.isEmpty()) {
                first = trimmed;
            }
        }
        return first;
    }

    /**
     * 检索词：把驼峰组件名拆成词，加上分类。
     *
     * <p>为什么重要：中文用户搜「文字滚动」时，字面上匹配不到
     * {@code RollerTypewriter}。但搜 "typewriter"、"roller" 能命中 ——
     * 这是模型补语义之前唯一的检索途径。</p>
     */
    static List<String> keywords(String component, String category) {
        List<String> words = new ArrayList<>();
        for (String part : component.split("(?=[A-Z])")) {
            String w = part.strip();
            if (w.length() >= 3) {
                words.add(w.toLowerCase(java.util.Locale.ROOT));
            }
        }
        if (category != null && !category.isBlank()) {
            words.add(category.replace("Animations", "").toLowerCase(java.util.Locale.ROOT));
        }
        return List.copyOf(new LinkedHashSet<>(words));
    }

    /**
     * 分类 = 组件所在的目录名。
     *
     * <p>不能用「路径第几段」：remotion-scenes 的路径是
     * {@code src/scenes/RollerAnimations/RollerTypewriter.tsx}，
     * 第一段是 src，取第一段会得到分类「src」（实测踩过）。
     * 取「文件所在目录」才对任何层级都成立。</p>
     */
    private static String topDirectory(String relative) {
        int slash = relative.lastIndexOf('/');
        if (slash <= 0) {
            return "";
        }
        String dir = relative.substring(0, slash);
        int lastSlash = dir.lastIndexOf('/');
        return lastSlash >= 0 ? dir.substring(lastSlash + 1) : dir;
    }

    private static String scanRootOf(Path scanRoot) {
        Path name = scanRoot != null ? scanRoot.getFileName() : null;
        return name == null ? "scene" : name.toString();
    }
}
