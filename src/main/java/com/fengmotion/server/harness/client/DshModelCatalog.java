package com.fengmotion.server.harness.client;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.springframework.stereotype.Component;

import com.fengmotion.server.harness.config.HarnessProperties;

import lombok.RequiredArgsConstructor;

/**
 * 从 DSH 读取某个 provider 路由下的真实模型目录。
 *
 * <p><strong>为什么读 {@code --dump-config} 而不是自己解析 patch 文件</strong>：
 * patch 只是用户覆盖层，真正的组合结果是 profile 层 + patch 层叠加后的配置树，
 * 而 {@code --dump-config} 打印的正是 DSH 自己组合出来的那棵树。读它才不会把
 * 「我抄了一份 patch」当成「DSH 实际在跑的配置」——后者才是唯一可信来源。</p>
 *
 * <p><strong>为什么不直连 provider 的 {@code /v1/models}</strong>：那等于绕过 DSH。
 * DSH 的配置里可能对模型做了 {@code modelOverrides}（改写上下文窗口、输出上限），
 * 直连 provider 拿到的是原始目录，与 DSH 实际使用的能力不一致。</p>
 *
 * <p>实现方式：{@code --dump-config} 输出的是 Cordis 条目列表 YAML，结构固定
 * （{@code - id: llm-pi-ai} → {@code config.providers.<providerId>.models[]}）。
 * 这里只读取这一段的几个固定字段，不做通用 YAML 解析——通用解析器要处理
 * {@code !!js} 标签与 Cordis 方言，而这段恰恰是纯标量，按缩进读更稳、也更容易测。</p>
 */
@Component
@RequiredArgsConstructor
public class DshModelCatalog {

    private final HarnessProperties properties;

    /**
     * 一个模型条目。
     *
     * @param id            模型 ID
     * @param label         展示名；配置未给时回落为 id
     * @param contextWindow 上下文窗口；配置未给时为 null
     * @param maxTokens     单次输出上限；配置未给时为 null
     */
    public record Entry(String id, String label, Long contextWindow, Long maxTokens) {
    }

    /**
     * 读取指定 provider 的模型目录。
     *
     * <p>失败时返回空列表而不是抛异常：模型目录读不到不应该让整个引擎探测失败，
     * 上层会把它表述为「模型目录未知」，而不是编一个模型出来。</p>
     *
     * @param providerId provider 路由名，例如 {@code agent2api-ecs}
     * @return 模型条目；读不到时为空
     */
    public List<Entry> read(String providerId) {
        if (providerId == null || providerId.isBlank()) {
            return List.of();
        }
        String dump = dumpConfig();
        if (dump == null) {
            return List.of();
        }
        return parseProviderModels(dump, providerId);
    }

    /**
     * 执行 {@code --dump-config} 并返回输出。
     *
     * @return 配置树文本；失败时为 null
     */
    private String dumpConfig() {
        // 顺序敏感：--profile 与 --patch 都是启动器参数，必须排在 --dump-config 之前。
        // 按顺序构造，不用下标插入（下标插入容易把 --patch 插到 --profile 前面）。
        List<String> command = new ArrayList<>();
        command.add(properties.getBin());
        command.add("--profile");
        command.add(properties.getProfile());
        var patch = properties.patchPath();
        if (patch != null) {
            command.add("--patch");
            command.add(patch.toString());
        }
        command.add("--dump-config");

        try {
            Process process = new ProcessBuilder(command)
                    .directory(properties.workingDirectory().toFile())
                    .redirectErrorStream(false)
                    .start();

            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append('\n');
                }
            }
            // stderr 必须排空，否则子进程可能因管道写满而阻塞。
            try (var err = process.getErrorStream()) {
                err.readAllBytes();
            }

            if (!process.waitFor(properties.getProbeTimeoutMs(), TimeUnit.MILLISECONDS)) {
                process.destroyForcibly();
                return null;
            }
            return process.exitValue() == 0 ? output.toString() : null;
        } catch (IOException failure) {
            return null;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    /**
     * 从配置树文本中提取指定 provider 的模型清单。
     *
     * <p>做法：先定位顶层 {@code - id: llm-pi-ai} 条目，再在其中定位
     * {@code providers:} 下的目标 provider 块，最后读取该块的 {@code models:} 列表。
     * 全程按缩进判断层级，不依赖固定行号。</p>
     *
     * @param dump       配置树文本
     * @param providerId provider 名
     * @return 模型条目
     */
    static List<Entry> parseProviderModels(String dump, String providerId) {
        String[] lines = dump.split("\n", -1);

        // 1) 定位顶层 llm-pi-ai 条目（顶格 '- id: llm-pi-ai'）
        int entryStart = -1;
        for (int i = 0; i < lines.length; i++) {
            if (lines[i].equals("- id: llm-pi-ai")) {
                entryStart = i;
                break;
            }
        }
        if (entryStart < 0) {
            return List.of();
        }

        // 2) 该条目到下一个顶格条目为止
        // 只认「顶格」的下一个条目。模型项也是 '- id: xxx' 但带缩进，
        // 用 startsWith 判定会把条目截断在第一个模型上（这是一个真实的坑）。
        int entryEnd = lines.length;
        for (int i = entryStart + 1; i < lines.length; i++) {
            if (indentOf(lines[i]) == 0
                    && (lines[i].startsWith("- id: ")
                    || lines[i].startsWith("- name: ")
                    || lines[i].startsWith("- insert:"))) {
                entryEnd = i;
                break;
            }
        }

        // 3) providers: 的缩进，以及目标 provider 的缩进
        int providersIndent = -1;
        int providerIndent = -1;
        int providerStart = -1;
        for (int i = entryStart; i < entryEnd; i++) {
            String line = lines[i];
            if (line.isBlank()) continue;
            int indent = indentOf(line);
            String trimmed = line.trim();

            if (providersIndent < 0 && trimmed.equals("providers:")) {
                providersIndent = indent;
                continue;
            }
            if (providersIndent >= 0 && providerStart < 0
                    && indent == providersIndent + 2
                    && trimmed.equals(providerId + ":")) {
                providerIndent = indent;
                providerStart = i;
                break;
            }
        }
        if (providerStart < 0) {
            return List.of();
        }

        // 4) 该 provider 块到同级下一个 provider 或条目结束
        int providerEnd = entryEnd;
        for (int i = providerStart + 1; i < entryEnd; i++) {
            String line = lines[i];
            if (line.isBlank()) continue;
            int indent = indentOf(line);
            if (indent <= providerIndent && !line.trim().startsWith("-")) {
                providerEnd = i;
                break;
            }
        }

        // 5) models: 列表；同时记下它所在的行号，后面按行号从它之后开始扫。
        int modelsLine = -1;
        for (int i = providerStart; i < providerEnd; i++) {
            if (lines[i].trim().equals("models:")) {
                modelsLine = i;
                break;
            }
        }
        if (modelsLine < 0) {
            return List.of();
        }

        // 6) 逐条读取列表项（形如 '          - id: xxx'）
        Map<String, Entry> entries = new LinkedHashMap<>();
        int itemIndent = -1;
        String currentId = null;
        String currentLabel = null;
        Long currentContext = null;
        Long currentMaxTokens = null;

        // 只从 models: 之后开始扫。这里必须用行号（modelsLine）比较，
        // 不能拿缩进值当行号用——那样会把第一个模型项整段跳过。
        for (int i = modelsLine + 1; i < providerEnd; i++) {
            String line = lines[i];
            if (line.isBlank()) continue;
            int indent = indentOf(line);
            String trimmed = line.trim();

            if (itemIndent < 0) {
                if (trimmed.startsWith("- id: ")) {
                    itemIndent = indent;
                } else {
                    continue;
                }
            }

            if (indent == itemIndent && trimmed.startsWith("- id: ")) {
                // 提交上一条
                if (currentId != null) {
                    entries.put(currentId, new Entry(
                            currentId,
                            currentLabel == null ? currentId : currentLabel,
                            currentContext,
                            currentMaxTokens));
                }
                currentId = valueOf(trimmed.substring(trimmed.indexOf("- id: ") + 6));
                currentLabel = null;
                currentContext = null;
                currentMaxTokens = null;
                continue;
            }
            if (indent != itemIndent + 2 || currentId == null) {
                continue;
            }
            if (trimmed.startsWith("name: ")) {
                currentLabel = valueOf(trimmed.substring(6));
            } else if (trimmed.startsWith("contextWindow: ")) {
                currentContext = parseLong(valueOf(trimmed.substring(15)));
            } else if (trimmed.startsWith("maxTokens: ")) {
                currentMaxTokens = parseLong(valueOf(trimmed.substring(11)));
            }
        }
        if (currentId != null) {
            entries.put(currentId, new Entry(
                    currentId,
                    currentLabel == null ? currentId : currentLabel,
                    currentContext,
                    currentMaxTokens));
        }
        return new ArrayList<>(entries.values());
    }

    /** 计算一行的缩进空格数。 */
    private static int indentOf(String line) {
        int n = 0;
        while (n < line.length() && line.charAt(n) == ' ') {
            n++;
        }
        return n;
    }

    /** 去掉 YAML 标量两侧的引号与空白。 */
    private static String valueOf(String raw) {
        String value = raw.trim();
        if (value.length() >= 2
                && ((value.startsWith("'") && value.endsWith("'"))
                || (value.startsWith("\"") && value.endsWith("\"")))) {
            value = value.substring(1, value.length() - 1);
        }
        return value;
    }

    /** 解析可选整数；无法解析时返回 null（不编造 0）。 */
    private static Long parseLong(String raw) {
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException notANumber) {
            return null;
        }
    }
}
