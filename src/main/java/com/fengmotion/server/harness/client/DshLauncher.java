package com.fengmotion.server.harness.client;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.springframework.stereotype.Component;

import com.fengmotion.server.harness.config.HarnessProperties;

import lombok.RequiredArgsConstructor;

/**
 * 启动 {@code dsh} 子进程。
 *
 * <p>本类只负责「把进程拉起来」以及「探测引擎是否可用」，不参与协议对话——
 * 协议由 {@link DshSdkSession} 处理。分开的原因是探测需要频繁做且要能失败，
 * 而对话是有状态的、昂贵的。</p>
 *
 * <p><strong>关于 {@code ELECTRON_RUN_AS_NODE}</p></strong>：这个环境变量会让 Electron
 * 退化成纯 Node，但本后端启动的是 {@code dsh} CLI（Node 程序），不经过 Electron，
 * 因此不受影响。仍显式清除它，是为了避免从 Electron 进程继承该变量时出现
 * 难以排查的行为差异。</p>
 */
@Component
@RequiredArgsConstructor
public class DshLauncher {

    private final HarnessProperties properties;

    /**
     * 启动一个新的 SDK 子进程。
     *
     * @return 已接管的进程通道
     * @throws IOException 无法启动时抛出（含 {@code dsh} 不在 PATH 的情形）
     */
    public DshProcess startSdk() throws IOException {
        List<String> command = new ArrayList<>();
        command.add(properties.getBin());
        command.add("--profile");
        command.add(properties.getProfile());

        Path patch = properties.patchPath();
        if (patch != null) {
            command.add("--patch");
            command.add(patch.toString());
        }

        // 挂载流式桥接插件：把 token 级帧转写到 stderr。用临时 patch 文件注入，
        // 不改用户自己的 profile —— 插件是后端的一部分，不该污染用户的 DSH 配置。
        Path plugin = properties.streamPluginPath();
        if (plugin != null) {
            Path overlay = writePluginOverlay(plugin);
            if (overlay != null) {
                command.add("--patch");
                command.add(overlay.toString());
            }
        }

        ProcessBuilder builder = new ProcessBuilder(command)
                .directory(properties.workingDirectory().toFile())
                // stderr 单独排空；stdout 留给协议帧。
                .redirectErrorStream(false);

        Map<String, String> environment = builder.environment();
        environment.remove("ELECTRON_RUN_AS_NODE");

        Process process = builder.start();
        return new DshProcess(process);
    }

    /**
     * 生成一个临时 patch 文件，把流式插件插入组合。
     *
     * <p>每次启动都重建：内容只有两行，重建成本远低于维护「文件是否过期」的判断。
     * 写失败时返回 null 并继续启动——流式是增强能力，缺了它仍应能正常对话。</p>
     *
     * @param pluginDir 插件目录（含 index.js）
     * @return 临时 patch 路径；失败时 null
     */
    private Path writePluginOverlay(Path pluginDir) {
        Path entry = pluginDir.resolve("index.js");
        if (!java.nio.file.Files.isRegularFile(entry)) {
            return null;
        }
        try {
            Path overlay = java.nio.file.Files.createTempFile("fengmotion-stream-", ".patch.yml");
            overlay.toFile().deleteOnExit();
            String content = """
                    - insert:
                        - id: fengmotion-stream
                          name: "%s"
                    """.formatted(entry.toAbsolutePath());
            java.nio.file.Files.writeString(overlay, content, java.nio.charset.StandardCharsets.UTF_8);
            return overlay;
        } catch (IOException failure) {
            return null;
        }
    }

    /**
     * 探测引擎版本。
     *
     * <p>用 {@code dsh --version} 而不是 {@code --dump-config}：后者会加载整棵插件树，
     * 在配置有错时既慢又会失败，而版本探测只需要确认「命令存在且能跑」。</p>
     *
     * @return 版本字符串；探测失败时返回 null
     */
    public String probeVersion() {
        List<String> command = List.of(properties.getBin(), "--version");
        try {
            Process process = new ProcessBuilder(command)
                    .redirectErrorStream(true)
                    .start();
            StringBuilder output = new StringBuilder();
            try (var reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append('\n');
                }
            }
            if (!process.waitFor(properties.getProbeTimeoutMs(), TimeUnit.MILLISECONDS)) {
                process.destroyForcibly();
                return null;
            }
            if (process.exitValue() != 0) {
                return null;
            }
            String text = output.toString().trim();
            return text.isEmpty() ? null : text;
        } catch (IOException notFound) {
            // 命令不存在：这是「引擎不可用」，不是服务出错，因此返回 null 交给上层表述。
            return null;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    /**
     * 判断 {@code dsh} 可执行文件是否可见。
     *
     * @return 配置里给的是绝对路径时检查文件存在；否则交给版本探测判定
     */
    public boolean isBinReachable() {
        Path configured = Path.of(properties.getBin());
        if (configured.isAbsolute()) {
            return Files.isExecutable(configured);
        }
        // 相对或裸命令名（例如 dsh）：不做 PATH 解析，交给 probeVersion 实测。
        return true;
    }
}
