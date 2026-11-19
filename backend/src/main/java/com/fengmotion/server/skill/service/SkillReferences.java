package com.fengmotion.server.skill.service;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.fengmotion.server.skill.domain.SkillInventory;

/**
 * 从 SKILL.md 找出它提到的组件，并顺着 import 带上依赖。只读清单与文本，不读网络、不执行。
 *
 * <p><strong>为什么按名字匹配</strong>：skill 常把组件放在 skill 目录之外，并且按名字引用。
 * 比如 snapcn 的 SKILL.md 写的是 {@code `logo-assemble`}、{@code @snapcn/logo-assemble}，
 * 示例代码里是安装后的路径 {@code @/components/snap-cn/logo-assemble}，
 * 而组件实际在仓库的 {@code registry/snap-cn/logo-assemble/index.tsx}，用仓库自己的 tsconfig 解析不到。</p>
 *
 * <p>名字匹配可能多算（比如提到的另一个 skill 碰巧和某个组件同名），所以有数量上限，
 * 最终由模型挑选、再经人工审阅。</p>
 */
public final class SkillReferences {

    static final int MAX_ENTRIES = 30;
    static final int MAX_DEPENDENCIES = 80;
    static final int MAX_DOCS = 30;

    private static final Pattern PATH_LIKE = Pattern.compile("[A-Za-z0-9_@./-]+\\.(?:tsx|ts|jsx|js|mjs)\\b");
    private static final Pattern INLINE_CODE = Pattern.compile("`([^`\\n]+)`");
    private static final Pattern SCOPED_NAME = Pattern.compile("@[a-z0-9][a-z0-9-]*/([A-Za-z0-9][A-Za-z0-9_-]*)");
    private static final Pattern IMPORT_FROM = Pattern.compile("from\\s+['\"]([^'\"\\n]+)['\"]");
    private static final Pattern NAME = Pattern.compile("[A-Za-z][A-Za-z0-9_-]{2,60}");
    private static final Pattern TEST_FILE = Pattern.compile(".*\\.(test|spec|stories)\\.[cm]?[jt]sx?$");

    private SkillReferences() {
    }

    /**
     * @param entries      SKILL.md 提到的组件（按在文中首次出现的顺序）
     * @param dependencies 这些组件顺着 import 带上的依赖（不含 entries 本身）
     * @param docs         与这些组件同名的文档，例如 {@code references/components/logo-assemble.md}
     */
    public record Related(List<String> entries, List<String> dependencies, List<String> docs) {
        public static Related none() {
            return new Related(List.of(), List.of(), List.of());
        }
    }

    /**
     * 分析一个 skill 引用了哪些组件。
     *
     * @param inventory 包的清单
     * @param skillPath SKILL.md 的包内路径
     * @param skillText SKILL.md 正文
     */
    public static Related analyze(SkillInventory inventory, String skillPath, String skillText) {
        if (skillText == null || skillText.isBlank()) return Related.none();
        String skillDir = skillPath.contains("/") ? skillPath.substring(0, skillPath.lastIndexOf('/')) : "";

        Map<String, SkillInventory.FileEntry> code = new LinkedHashMap<>();
        for (var file : inventory.files()) {
            if (isComponentCandidate(file)) {
                code.put(file.path(), file);
            }
        }

        Set<String> entries = new LinkedHashSet<>();
        /* 1. 写了包内路径（相对包根或 skill 目录），或带扩展名的文件名 */
        Matcher paths = PATH_LIKE.matcher(skillText);
        while (paths.find() && entries.size() < MAX_ENTRIES) {
            String token = paths.group().replaceFirst("^\\./", "");
            if (token.contains("/")) {
                if (code.containsKey(token)) entries.add(token);
                else {
                    String inSkill = join(skillDir, token);
                    if (inSkill != null && code.containsKey(inSkill)) entries.add(inSkill);
                }
            } else {
                entries.addAll(byFileName(code.keySet(), token, skillDir));
            }
        }
        /* 2. 按名字：反引号里的词、@scope/名字、示例 import 路径的最后一段 */
        for (String name : nameTokens(skillText)) {
            if (entries.size() >= MAX_ENTRIES) break;
            for (String path : code.keySet()) {
                if (name.equals(componentName(path))) entries.add(path);
                if (entries.size() >= MAX_ENTRIES) break;
            }
        }
        List<String> entryList = List.copyOf(entries);

        List<String> dependencies = closure(inventory, entryList, MAX_DEPENDENCIES);

        Set<String> names = new LinkedHashSet<>();
        for (String entry : entryList) names.add(componentName(entry));
        List<String> docs = new ArrayList<>();
        for (var file : inventory.files()) {
            if (docs.size() >= MAX_DOCS) break;
            if (!file.category().equals("doc") || file.path().equals(skillPath)) continue;
            if (names.contains(stem(fileName(file.path())))) docs.add(file.path());
        }
        return new Related(entryList, dependencies, List.copyOf(docs));
    }

    /**
     * 从入口出发，顺着清单里已解析的相对引用和别名引用找依赖（广度优先，排除测试文件）。
     *
     * @return 依赖路径，不含入口本身
     */
    public static List<String> closure(SkillInventory inventory, Collection<String> entries, int max) {
        Map<String, SkillInventory.FileEntry> files = new LinkedHashMap<>();
        for (var file : inventory.files()) files.put(file.path(), file);
        Set<String> seen = new LinkedHashSet<>(entries);
        Set<String> found = new LinkedHashSet<>();
        Deque<String> queue = new ArrayDeque<>(entries);
        while (!queue.isEmpty() && found.size() < max) {
            var file = files.get(queue.poll());
            if (file == null || file.imports() == null) continue;
            for (var ref : file.imports()) {
                if (!(ref.kind().equals("relative") || ref.kind().equals("alias")) || ref.resolved() == null) continue;
                String target = ref.resolved();
                if (isTest(target) || !files.containsKey(target) || !seen.add(target)) continue;
                found.add(target);
                queue.add(target);
                if (found.size() >= max) break;
            }
        }
        return List.copyOf(found);
    }

    /** 组件名：{@code index.*} 取所在目录名，否则取去掉扩展名的文件名。 */
    static String componentName(String path) {
        String stem = stem(fileName(path));
        if (!stem.equals("index")) return stem;
        String dir = path.contains("/") ? path.substring(0, path.lastIndexOf('/')) : "";
        return dir.isEmpty() ? stem : fileName(dir);
    }

    static boolean isTest(String path) {
        return path.contains("/__tests__/") || path.startsWith("__tests__/") || TEST_FILE.matcher(path).matches();
    }

    public static boolean isComponentCandidate(SkillInventory.FileEntry file) {
        if (!("component".equals(file.category()) || "code".equals(file.category())) || isTest(file.path())) return false;
        if (!Set.of("index", "main", "bootstrap", "entry").contains(stem(fileName(file.path()))) || file.imports() == null) return true;
        boolean mountsApp = file.imports().stream().anyMatch(ref -> ref.specifier().matches("(?i)\\./(?:App|Root|bootstrap)(?:\\.[cm]?[jt]sx?)?"));
        boolean loadsTheme = file.imports().stream().anyMatch(ref -> ref.specifier().matches("(?i)(?:.*/)?(?:globals?|index|app|main)\\.(?:css|scss|sass|less)"));
        return !(mountsApp && loadsTheme);
    }

    private static Set<String> nameTokens(String text) {
        Set<String> out = new LinkedHashSet<>();
        Matcher inline = INLINE_CODE.matcher(text);
        while (inline.find()) {
            for (String part : inline.group(1).split("[\\s,|()]+")) addName(out, part, false);
        }
        Matcher scoped = SCOPED_NAME.matcher(text);
        while (scoped.find()) addName(out, scoped.group(1), true);
        Matcher imports = IMPORT_FROM.matcher(text);
        while (imports.find()) {
            String specifier = imports.group(1);
            addName(out, specifier.substring(specifier.lastIndexOf('/') + 1), true);
        }
        return out;
    }

    /**
     * 反引号里的普通词只收两类：带连字符的（logo-assemble）或首字母大写的组件名（SvgArt），
     * 避免把 {@code remotion}、{@code staticFile} 这类词当成组件。@scope/名字 与 import 路径本身就是模块名，不受此限。
     */
    private static void addName(Set<String> out, String raw, boolean trusted) {
        String token = raw.strip().replaceFirst("\\.(tsx|ts|jsx|js|mjs)$", "");
        if (!NAME.matcher(token).matches()) return;
        if (trusted || token.contains("-") || Character.isUpperCase(token.charAt(0))) out.add(token);
    }

    private static List<String> byFileName(Collection<String> paths, String name, String skillDir) {
        List<String> inSkill = new ArrayList<>();
        List<String> anywhere = new ArrayList<>();
        String prefix = skillDir.isEmpty() ? "" : skillDir + "/";
        for (String path : paths) {
            if (!fileName(path).equals(name)) continue;
            if (path.startsWith(prefix)) inSkill.add(path);
            else anywhere.add(path);
        }
        return inSkill.isEmpty() ? anywhere : inSkill;
    }

    private static String join(String dir, String relative) {
        List<String> parts = new ArrayList<>();
        if (!dir.isEmpty()) parts.addAll(List.of(dir.split("/")));
        for (String segment : relative.split("/")) {
            if (segment.isEmpty() || segment.equals(".")) continue;
            if (segment.equals("..")) {
                if (parts.isEmpty()) return null;
                parts.remove(parts.size() - 1);
            } else {
                parts.add(segment);
            }
        }
        return String.join("/", parts);
    }

    private static String fileName(String path) {
        return path.contains("/") ? path.substring(path.lastIndexOf('/') + 1) : path;
    }

    private static String stem(String name) {
        int dot = name.indexOf('.');
        return dot <= 0 ? name : name.substring(0, dot);
    }
}
