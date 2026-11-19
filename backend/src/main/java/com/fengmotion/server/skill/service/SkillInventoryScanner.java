package com.fengmotion.server.skill.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

import com.fasterxml.jackson.core.json.JsonReadFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fengmotion.server.skill.domain.SkillInventory;
import com.fengmotion.server.skill.domain.SkillInventory.Dependencies;
import com.fengmotion.server.skill.domain.SkillInventory.FileEntry;
import com.fengmotion.server.skill.domain.SkillInventory.ImportRef;
import com.fengmotion.server.skill.domain.SkillInventory.InstructedCommand;
import com.fengmotion.server.skill.domain.SkillInventory.License;
import com.fengmotion.server.skill.domain.SkillInventory.ScriptEntry;
import com.fengmotion.server.skill.domain.SkillInventory.Skill;
import com.fengmotion.server.skill.domain.SkillInventory.Summary;

/**
 * skill 包的静态清点。
 *
 * <p><strong>只读、只解析，不执行</strong>：不调用 node / npm / shell，不加载包内代码。
 * 同一份目录内容总是得到同一份报告（所有列表都排过序）。</p>
 *
 * <p>import 依赖用正则提取：注释里的 import、字符串拼接出来的模块名都可能多算或漏算，
 * 所以报告标明 {@code approximate=true}，后续步骤不能把它当成精确依赖图。</p>
 */
public class SkillInventoryScanner {

    /** 超过这个大小的文本文件不做 frontmatter / import 解析，只记大小与哈希。 */
    static final long MAX_PARSE_BYTES = 2L * 1024 * 1024;

    private static final Set<String> DOC_EXT = Set.of("md", "mdx", "markdown", "txt", "rst");
    private static final Set<String> COMPONENT_EXT = Set.of("tsx", "jsx");
    private static final Set<String> CODE_EXT = Set.of("ts", "js", "mjs", "cjs", "mts", "cts");
    private static final Set<String> SCRIPT_EXT = Set.of("sh", "bash", "zsh", "fish", "py", "ps1", "bat", "cmd", "rb", "pl");
    private static final Set<String> CONFIG_EXT = Set.of("json", "jsonc", "yml", "yaml", "toml", "ini", "lock");
    private static final Set<String> ASSET_EXT = Set.of(
            "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif", "bmp",
            "mp3", "wav", "ogg", "m4a", "aac", "flac",
            "mp4", "webm", "mov", "mkv",
            "ttf", "otf", "woff", "woff2");
    private static final Set<String> JS_LIKE_EXT = Set.of("ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts");
    private static final Set<String> NODE_BUILTINS = Set.of(
            "assert", "buffer", "child_process", "cluster", "crypto", "dgram", "dns", "events", "fs", "http",
            "http2", "https", "module", "net", "os", "path", "perf_hooks", "process", "querystring", "readline",
            "stream", "string_decoder", "timers", "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib");
    private static final List<String> RESOLVE_SUFFIXES = List.of(
            "", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".d.ts",
            "/index.ts", "/index.tsx", "/index.js", "/index.jsx");
    /** SKILL.md 里行内代码的第一个词是这些时，才算「要求运行的命令」。 */
    private static final Set<String> RUNNERS = Set.of(
            "bash", "sh", "zsh", "node", "npx", "npm", "pnpm", "yarn", "bun", "bunx", "deno", "python", "python3",
            "pip", "pip3", "uv", "uvx", "chmod", "curl", "wget", "git", "make", "ffmpeg", "remotion");
    private static final Set<String> SHELL_FENCES = Set.of("bash", "sh", "shell", "zsh", "console", "terminal");

    private static final Pattern IMPORT_FROM = Pattern.compile(
            "(?m)^\\s*import\\s+(?:type\\s+)?(?:[^'\"`;]*?\\s+from\\s+)?['\"]([^'\"\\n]+)['\"]");
    private static final Pattern EXPORT_FROM = Pattern.compile(
            "(?m)^\\s*export\\s+(?:type\\s+)?(?:\\*(?:\\s+as\\s+\\w+)?|\\{[^}]*\\})\\s+from\\s+['\"]([^'\"\\n]+)['\"]");
    private static final Pattern REQUIRE = Pattern.compile("\\brequire\\(\\s*['\"]([^'\"\\n]+)['\"]\\s*\\)");
    private static final Pattern DYNAMIC_IMPORT = Pattern.compile("\\bimport\\(\\s*['\"]([^'\"\\n]+)['\"]\\s*\\)");
    private static final Pattern FENCE = Pattern.compile("(?ms)^\\s*```([A-Za-z0-9_-]*)[^\\n]*\\n(.*?)^\\s*```");
    private static final Pattern INLINE_CODE = Pattern.compile("`([^`\\n]+)`");
    private static final Pattern LICENSE_FILE = Pattern.compile("(?i)^(licen[cs]e|copying)([.-].*)?$");

    private final ObjectMapper lenientJson = JsonMapper.builder()
            .enable(JsonReadFeature.ALLOW_JAVA_COMMENTS)
            .enable(JsonReadFeature.ALLOW_TRAILING_COMMA)
            .build();

    /**
     * 清点一个已解压的包目录。
     *
     * @param root 包根目录
     * @return 报告
     */
    public SkillInventory scan(Path root) throws IOException {
        Path base = root.toAbsolutePath().normalize();
        List<Path> paths;
        try (Stream<Path> walk = Files.walk(base)) {
            paths = walk.filter(p -> Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS))
                    .sorted((a, b) -> rel(base, a).compareTo(rel(base, b)))
                    .toList();
        }
        Set<String> allFiles = new LinkedHashSet<>();
        for (Path p : paths) allFiles.add(rel(base, p));

        List<String> warnings = new ArrayList<>();
        List<Skill> skills = new ArrayList<>();
        List<ScriptEntry> scripts = new ArrayList<>();
        List<InstructedCommand> commands = new ArrayList<>();
        List<FileEntry> files = new ArrayList<>();
        Map<String, String> declared = new TreeMap<>();
        Set<String> used = new TreeSet<>();
        List<String> licenseFiles = new ArrayList<>();
        String packageJsonLicense = null;
        Map<String, Integer> categories = new TreeMap<>();
        long totalBytes = 0;
        int unresolved = 0;

        Map<String, AliasConfig> aliases = loadAliases(base, allFiles, warnings);

        for (Path file : paths) {
            String path = rel(base, file);
            byte[] bytes = Files.readAllBytes(file);
            totalBytes += bytes.length;
            boolean parseable = bytes.length <= MAX_PARSE_BYTES;
            String text = parseable ? new String(bytes, StandardCharsets.UTF_8) : null;
            String name = fileName(path);
            String ext = extension(name);

            String category = categorize(name, ext, text);
            categories.merge(category, 1, Integer::sum);

            if (LICENSE_FILE.matcher(name).matches()) licenseFiles.add(path);

            if (category.equals("script")) {
                scripts.add(new ScriptEntry(path, "file", null,
                        SCRIPT_EXT.contains(ext) ? "扩展名 ." + ext : "首行是 shebang"));
            }

            if (category.equals("skill")) {
                if (text == null) {
                    warnings.add(path + " 超过 " + (MAX_PARSE_BYTES / (1024 * 1024)) + "MB，未解析");
                } else {
                    skills.add(parseSkill(path, text, warnings));
                    for (String command : instructedCommands(text)) commands.add(new InstructedCommand(path, command));
                }
            }

            if (name.equals("package.json") && text != null) {
                JsonNode pkg = readJson(text);
                if (pkg == null) {
                    warnings.add(path + " 不是合法 JSON，未读取依赖与 scripts");
                } else {
                    for (String field : List.of("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")) {
                        pkg.path(field).fields().forEachRemaining(e -> declared.putIfAbsent(e.getKey(), e.getValue().asText()));
                    }
                    pkg.path("scripts").fields().forEachRemaining(e -> scripts.add(new ScriptEntry(path, "npm-script",
                            e.getKey(), "package.json scripts：" + e.getValue().asText())));
                    if (packageJsonLicense == null && pkg.path("license").isTextual()) {
                        packageJsonLicense = pkg.path("license").asText();
                    }
                }
            }

            List<ImportRef> imports = null;
            if (JS_LIKE_EXT.contains(ext)) {
                if (text == null) {
                    warnings.add(path + " 超过 " + (MAX_PARSE_BYTES / (1024 * 1024)) + "MB，未提取 import");
                } else {
                    imports = new ArrayList<>();
                    for (String specifier : importSpecifiers(text)) {
                        ImportRef ref = classify(path, specifier, allFiles, aliasFor(path, aliases));
                        imports.add(ref);
                        if (ref.kind().equals("package")) used.add(ref.resolved());
                        if ((ref.kind().equals("relative") || ref.kind().equals("alias")) && ref.resolved() == null) unresolved++;
                    }
                }
            }
            files.add(new FileEntry(path, bytes.length, sha256(bytes), category, imports));
        }

        if (skills.isEmpty()) warnings.add("没有找到 SKILL.md：这可能不是一个 skill 包");

        List<String> undeclared = used.stream().filter(p -> !declared.containsKey(p)).toList();
        Map<String, String> remotion = new TreeMap<>();
        declared.forEach((k, v) -> {
            if (k.equals("remotion") || k.startsWith("@remotion/")) remotion.put(k, v);
        });

        licenseFiles.sort((a, b) -> a.split("/").length != b.split("/").length
                ? Integer.compare(a.split("/").length, b.split("/").length) : a.compareTo(b));
        String spdx = detectLicense(base, licenseFiles);
        if (spdx.equals("unknown") && packageJsonLicense != null && !packageJsonLicense.isBlank()) spdx = packageJsonLicense;

        return new SkillInventory(SkillInventory.VERSION, skills, files, scripts, dedupe(commands),
                new Dependencies(declared, List.copyOf(used), undeclared, remotion, true),
                new License(spdx, licenseFiles, packageJsonLicense), warnings,
                new Summary(skills.size(), files.size(), totalBytes, categories, scripts.size(), unresolved));
    }

    /* ── 分类 ─────────────────────────────────────────────────────── */

    private static String categorize(String name, String ext, String text) {
        if (name.equalsIgnoreCase("SKILL.md")) return "skill";
        if (text != null && text.startsWith("#!")) return "script";
        if (SCRIPT_EXT.contains(ext)) return "script";
        if (LICENSE_FILE.matcher(name).matches() || DOC_EXT.contains(ext)) return "doc";
        if (COMPONENT_EXT.contains(ext)) return "component";
        if (CODE_EXT.contains(ext)) return "code";
        if (ASSET_EXT.contains(ext)) return "asset";
        if (CONFIG_EXT.contains(ext) || name.startsWith("remotion.config.") || name.startsWith("vite.config.")
                || name.startsWith("tsconfig") || name.equals(".npmrc") || name.equals(".nvmrc")) return "config";
        return "other";
    }

    /* ── SKILL.md ─────────────────────────────────────────────────── */

    private static Skill parseSkill(String path, String text, List<String> warnings) {
        String directory = path.contains("/") ? path.substring(0, path.lastIndexOf('/')) : "";
        String body = text.startsWith("\uFEFF") ? text.substring(1) : text;
        body = body.replace("\r\n", "\n");
        if (!body.startsWith("---\n")) {
            warnings.add(path + " 没有 frontmatter");
            return new Skill(path, directory, null, null, Map.of(), null);
        }
        int end = body.indexOf("\n---", 3);
        if (end < 0) {
            warnings.add(path + " 的 frontmatter 没有结束标记");
            return new Skill(path, directory, null, null, Map.of(), "frontmatter 没有结束标记 ---");
        }
        String yaml = body.substring(4, end);
        try {
            LoaderOptions options = new LoaderOptions();
            options.setMaxAliasesForCollections(20);
            options.setCodePointLimit(64 * 1024);
            options.setAllowDuplicateKeys(false);
            Object parsed = new Yaml(new SafeConstructor(options)).load(yaml);
            if (parsed == null) return new Skill(path, directory, null, null, Map.of(), null);
            if (!(parsed instanceof Map<?, ?> map)) {
                warnings.add(path + " 的 frontmatter 不是键值对");
                return new Skill(path, directory, null, null, Map.of(), "frontmatter 不是键值对");
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> meta = (Map<String, Object>) jsonSafe(map);
            return new Skill(path, directory, stringOrNull(meta.get("name")), stringOrNull(meta.get("description")), meta, null);
        } catch (RuntimeException invalid) {
            String reason = invalid.getMessage() == null ? invalid.getClass().getSimpleName()
                    : invalid.getMessage().lines().findFirst().orElse("");
            warnings.add(path + " 的 frontmatter 解析失败");
            return new Skill(path, directory, null, null, Map.of(), "frontmatter 解析失败：" + reason);
        }
    }

    /** 把 YAML 结果转成 JSON 能表达的值：键一律转字符串，日期转 ISO 文本。 */
    private static Object jsonSafe(Object value) {
        if (value == null || value instanceof String || value instanceof Number || value instanceof Boolean) return value;
        if (value instanceof Date date) return date.toInstant().toString();
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> out = new LinkedHashMap<>();
            map.forEach((k, v) -> out.put(String.valueOf(k), jsonSafe(v)));
            return out;
        }
        if (value instanceof Collection<?> list) return list.stream().map(SkillInventoryScanner::jsonSafe).toList();
        if (value instanceof byte[]) return "(binary)";
        return String.valueOf(value);
    }

    /** SKILL.md 里要求运行的命令：shell 代码块里的每一行，以及以常见运行器开头的行内代码。 */
    static List<String> instructedCommands(String text) {
        Set<String> out = new LinkedHashSet<>();
        String body = text.replace("\r\n", "\n");
        Matcher fence = FENCE.matcher(body);
        StringBuilder outside = new StringBuilder();
        int last = 0;
        while (fence.find()) {
            outside.append(body, last, fence.start());
            last = fence.end();
            if (!SHELL_FENCES.contains(fence.group(1).toLowerCase(Locale.ROOT))) continue;
            for (String line : fence.group(2).split("\n")) {
                String command = line.strip();
                if (command.startsWith("$ ")) command = command.substring(2).strip();
                if (command.isEmpty() || command.startsWith("#")) continue;
                out.add(command);
            }
        }
        outside.append(body.substring(last));
        Matcher inline = INLINE_CODE.matcher(outside);
        while (inline.find()) {
            String command = inline.group(1).strip();
            String first = command.split("\\s+")[0];
            if (RUNNERS.contains(first) || first.startsWith("./") || first.endsWith(".sh") || first.endsWith(".py")) {
                if (command.contains(" ") || first.startsWith("./")) out.add(command);
            }
        }
        return out.stream().limit(200).toList();
    }

    /* ── import ───────────────────────────────────────────────────── */

    static List<String> importSpecifiers(String text) {
        Set<String> out = new LinkedHashSet<>();
        for (Pattern pattern : List.of(IMPORT_FROM, EXPORT_FROM, REQUIRE, DYNAMIC_IMPORT)) {
            Matcher m = pattern.matcher(text);
            while (m.find()) out.add(m.group(1).strip());
        }
        return List.copyOf(out);
    }

    private static ImportRef classify(String from, String specifier, Set<String> files, AliasConfig alias) {
        if (specifier.startsWith("./") || specifier.startsWith("../")) {
            String dir = from.contains("/") ? from.substring(0, from.lastIndexOf('/')) : "";
            return new ImportRef(specifier, "relative", resolveFile(join(dir, specifier), files));
        }
        String bare = specifier.startsWith("node:") ? specifier.substring(5) : specifier;
        String head = bare.split("/")[0];
        if (specifier.startsWith("node:") || NODE_BUILTINS.contains(head)) {
            return new ImportRef(specifier, "builtin", head);
        }
        if (alias != null) {
            /* 和 TypeScript 一样选模式：精确匹配优先，否则取 * 前缀最长的那个。
               按书写顺序取第一个会选错：同时有 "@/lib/x/*" 和 "@/*" 时，"@/*" 写在前面就会被它截走。 */
            Map.Entry<String, List<String>> best = null;
            String bestTarget = null;
            int bestRank = -1;
            for (var entry : alias.paths().entrySet()) {
                String target = matchAlias(entry.getKey(), specifier);
                if (target == null) continue;
                int star = entry.getKey().indexOf('*');
                int rank = star < 0 ? Integer.MAX_VALUE : star;
                if (rank > bestRank) {
                    best = entry;
                    bestTarget = target;
                    bestRank = rank;
                }
            }
            if (best != null) {
                for (String replacement : best.getValue()) {
                    String candidate = join(alias.baseDir(), replacement.replace("*", bestTarget));
                    String resolved = resolveFile(candidate, files);
                    if (resolved != null) return new ImportRef(specifier, "alias", resolved);
                }
                return new ImportRef(specifier, "alias", null);
            }
        }
        if (specifier.startsWith("@/") || specifier.startsWith("~/") || specifier.startsWith("#")) {
            return new ImportRef(specifier, "alias", null);
        }
        String name = specifier.startsWith("@") && specifier.contains("/")
                ? String.join("/", List.of(specifier.split("/")).subList(0, 2))
                : head;
        return new ImportRef(specifier, "package", name);
    }

    /** tsconfig paths 的模式匹配：支持一个 {@code *} 通配；返回 {@code *} 匹配到的部分，不匹配为 null。 */
    private static String matchAlias(String pattern, String specifier) {
        int star = pattern.indexOf('*');
        if (star < 0) return pattern.equals(specifier) ? "" : null;
        String prefix = pattern.substring(0, star);
        String suffix = pattern.substring(star + 1);
        if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)
                || specifier.length() < prefix.length() + suffix.length()) return null;
        return specifier.substring(prefix.length(), specifier.length() - suffix.length());
    }

    private static String resolveFile(String candidate, Set<String> files) {
        if (candidate == null) return null;
        List<String> tries = new ArrayList<>();
        for (String suffix : RESOLVE_SUFFIXES) tries.add(candidate + suffix);
        // TypeScript ESM 习惯写 './x.js' 指向 x.ts
        if (candidate.endsWith(".js")) {
            String stem = candidate.substring(0, candidate.length() - 3);
            tries.add(stem + ".ts");
            tries.add(stem + ".tsx");
        }
        for (String t : tries) if (files.contains(t)) return t;
        return null;
    }

    /** 拼接并规整包内路径；走出包根时返回 null。 */
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

    /* ── tsconfig paths ───────────────────────────────────────────── */

    private record AliasConfig(String baseDir, Map<String, List<String>> paths) {
    }

    private Map<String, AliasConfig> loadAliases(Path base, Set<String> files, List<String> warnings) throws IOException {
        Map<String, AliasConfig> byDir = new TreeMap<>();
        for (String path : files) {
            if (!fileName(path).equals("tsconfig.json")) continue;
            Path file = base.resolve(path);
            if (Files.size(file) > MAX_PARSE_BYTES) continue;
            JsonNode config = readJson(Files.readString(file));
            String dir = path.contains("/") ? path.substring(0, path.lastIndexOf('/')) : "";
            if (config == null) {
                warnings.add(path + " 无法解析，路径别名未生效");
                continue;
            }
            JsonNode options = config.path("compilerOptions");
            JsonNode paths = options.path("paths");
            if (!paths.isObject()) continue;
            String baseUrl = options.path("baseUrl").asText(".");
            String baseDir = join(dir, baseUrl);
            if (baseDir == null) continue;
            Map<String, List<String>> map = new LinkedHashMap<>();
            paths.fields().forEachRemaining(e -> {
                List<String> targets = new ArrayList<>();
                e.getValue().forEach(t -> targets.add(t.asText()));
                map.put(e.getKey(), targets);
            });
            byDir.put(dir, new AliasConfig(baseDir, map));
        }
        return byDir;
    }

    /** 取离文件最近的上级目录里的 tsconfig paths。 */
    private static AliasConfig aliasFor(String path, Map<String, AliasConfig> byDir) {
        String dir = path.contains("/") ? path.substring(0, path.lastIndexOf('/')) : "";
        while (true) {
            AliasConfig config = byDir.get(dir);
            if (config != null) return config;
            if (dir.isEmpty()) return null;
            dir = dir.contains("/") ? dir.substring(0, dir.lastIndexOf('/')) : "";
        }
    }

    /* ── 许可证 ───────────────────────────────────────────────────── */

    private static String detectLicense(Path base, List<String> licenseFiles) throws IOException {
        for (String path : licenseFiles) {
            Path file = base.resolve(path);
            if (Files.size(file) > MAX_PARSE_BYTES) continue;
            String text = Files.readString(file, StandardCharsets.UTF_8).replaceAll("\\s+", " ");
            String lower = text.toLowerCase(Locale.ROOT);
            if (lower.contains("permission is hereby granted, free of charge")) return "MIT";
            if (lower.contains("apache license") && lower.contains("version 2.0")) return "Apache-2.0";
            if (lower.contains("mozilla public license") && lower.contains("2.0")) return "MPL-2.0";
            if (lower.contains("gnu lesser general public license")) return "LGPL";
            if (lower.contains("gnu affero general public license")) return "AGPL-3.0";
            if (lower.contains("gnu general public license")) {
                return lower.contains("version 3") ? "GPL-3.0" : lower.contains("version 2") ? "GPL-2.0" : "GPL";
            }
            if (lower.contains("redistribution and use in source and binary forms")) {
                return lower.contains("neither the name") ? "BSD-3-Clause" : "BSD-2-Clause";
            }
            if (lower.contains("permission to use, copy, modify, and/or distribute this software")) return "ISC";
            if (lower.contains("this is free and unencumbered software released into the public domain")) return "Unlicense";
            if (lower.contains("attribution 4.0 international")) {
                return lower.contains("sharealike") ? "CC-BY-SA-4.0" : "CC-BY-4.0";
            }
        }
        return "unknown";
    }

    /* ── 工具 ─────────────────────────────────────────────────────── */

    private JsonNode readJson(String text) {
        try {
            return lenientJson.readTree(text);
        } catch (IOException invalid) {
            return null;
        }
    }

    private static List<InstructedCommand> dedupe(List<InstructedCommand> commands) {
        Set<String> seen = new LinkedHashSet<>();
        List<InstructedCommand> out = new ArrayList<>();
        for (InstructedCommand c : commands) if (seen.add(c.skillPath() + "\n" + c.command())) out.add(c);
        return out;
    }

    private static String rel(Path base, Path file) {
        return base.relativize(file).toString().replace('\\', '/');
    }

    private static String fileName(String path) {
        return path.contains("/") ? path.substring(path.lastIndexOf('/') + 1) : path;
    }

    private static String extension(String name) {
        int dot = name.lastIndexOf('.');
        return dot <= 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static String stringOrNull(Object value) {
        return value instanceof String s && !s.isBlank() ? s : null;
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
