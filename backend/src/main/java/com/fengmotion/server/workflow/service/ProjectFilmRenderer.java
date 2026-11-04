package com.fengmotion.server.workflow.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 渲染项目级 Remotion 工程（agent 写的源码）。
 *
 * <p>与 {@link com.fengmotion.server.catalog.service.RemotionRenderer} 的分工：
 * 那个渲染内置 {@code Film} + scenes props；这个渲染项目自己的工程入口。
 * 两者共用同一份依赖与同一套踩坑处理（见 {@code render-shared.mjs}）。</p>
 *
 * <p><strong>超时是配置，不是产品规则</strong>：构建 + 渲染的耗时随项目规模与机器
 * 差别很大，写死一个值必然要么误杀要么白等。默认给短片一个保守值，可调。
 * 超时要能区分「超时」与「渲染失败」，并清理整棵进程树 —— 否则会留下
 * 一个占着 CPU 的 Chromium。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ProjectFilmRenderer {

    private final ObjectMapper json;

    /** Remotion 工程目录（含 render-project.mjs）。与内置渲染器共用同一配置项。 */
    @Value("${fengmotion.remotion.project-dir:}")
    private String remotionDir;

    /** node 可执行文件。 */
    @Value("${fengmotion.remotion.node:node}")
    private String nodeBinary;

    /** 依赖目录。 */
    @Value("${fengmotion.remotion.node-modules:}")
    private String nodeModules;

    /** 浏览器可执行文件。留空则让 Remotion 自己下载 chrome-headless-shell。 */
    @Value("${fengmotion.remotion.browser:}")
    private String browser;

    /**
     * 浏览器缓存目录。
     *
     * <p>不传的话 Remotion 会把 chrome-headless-shell 下到临时工作目录，
     * 而那个目录每次渲染后都会删除 —— 等于每次重下 90MB。
     * 指向应用数据目录后，首次之后直接复用。</p>
     */
    @Value("${fengmotion.remotion.browser-cache:}")
    private String browserCache;

    /**
     * 渲染超时（秒）。默认 15 分钟：项目工程要先 bundle 再渲染，
     * 比内置 scenes 慢不少。可按机器与项目规模调整。
     */
    @Value("${fengmotion.remotion.project-timeout-seconds:900}")
    private long timeoutSeconds;

    /**
     * 渲染一个项目工程。
     *
     * @param projectRoot 项目根目录
     * @param config      工程配置
     * @param output      输出文件
     * @return 渲染结果
     * @throws ApiException 超时、失败或环境缺失
     */
    public Result render(Path projectRoot, ProjectFilmConfig.FilmConfig config, Path output) {
        Path script = resolveScript();

        List<String> command = new ArrayList<>();
        command.add(nodeBinary);
        command.add(script.toString());
        command.add("--project");
        command.add(projectRoot.toString());
        command.add("--entry");
        command.add(config.entry());
        command.add("--composition");
        command.add(config.compositionId());
        command.add("--out");
        command.add(output.toString());
        if (browser != null && !browser.isBlank()) {
            command.add("--browser");
            command.add(browser);
        }

        Path stdoutFile = null;
        Path stderrFile = null;
        Process process = null;
        try {
            Files.createDirectories(output.getParent());
            /* 输出重定向到文件而不是管道：bundle 与 Remotion 的日志很多，
               管道写满会阻塞子进程，表现为「渲染卡住」。 */
            stdoutFile = Files.createTempFile("fm-proj-render-out-", ".log");
            stderrFile = Files.createTempFile("fm-proj-render-err-", ".log");
            ProcessBuilder builder = new ProcessBuilder(command)
                    .directory(projectRoot.toFile())
                    .redirectOutput(stdoutFile.toFile())
                    .redirectError(stderrFile.toFile());
            if (nodeModules != null && !nodeModules.isBlank()) {
                builder.environment().put("FENGMOTION_NODE_MODULES", nodeModules);
            }
            if (browserCache != null && !browserCache.isBlank()) {
                builder.environment().put("FENGMOTION_BROWSER_CACHE", browserCache);
            }

            process = builder.start();
            boolean finished;
            try {
                finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                killTree(process);
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "render_interrupted",
                        "渲染被中断");
            }
            if (!finished) {
                /* 超时必须杀掉整棵进程树：node 会拉起 Chromium，
                   只杀父进程会留下占满 CPU 的孤儿。 */
                killTree(process);
                String tail = readTail(stderrFile);
                log.warn("项目工程渲染超时（{}秒）：{}", timeoutSeconds, tail);
                throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "render_timeout",
                        "渲染超时（超过 " + timeoutSeconds + " 秒）。可以调大 "
                                + "fengmotion.remotion.project-timeout-seconds 后重试。");
            }

            String stdout = Files.readString(stdoutFile, StandardCharsets.UTF_8).trim();
            String stderr = Files.readString(stderrFile, StandardCharsets.UTF_8);
            return parse(stdout, stderr, process.exitValue(), output);
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "renderer_unavailable",
                    "无法启动渲染进程（需要 node）：" + failure.getMessage());
        } finally {
            deleteQuietly(stdoutFile);
            deleteQuietly(stderrFile);
        }
    }

    /**
     * 解析渲染脚本输出。
     *
     * <p>stdout 只应有最后一行 JSON。解析不了时把 stderr 尾巴带出来 ——
     * 真正原因（缺依赖、esbuild 报错、入口语法错）都在那里，
     * 只回一句「输出不是 JSON」等于没有信息。</p>
     *
     * @param stdout    标准输出
     * @param stderr    标准错误
     * @param exitCode  退出码
     * @param output    期望的产物
     * @return 结果
     */
    private Result parse(String stdout, String stderr, int exitCode, Path output) {
        JsonNode node = null;
        int lastLine = stdout.lastIndexOf('\n');
        String candidate = lastLine >= 0 ? stdout.substring(lastLine + 1) : stdout;
        try {
            node = json.readTree(candidate);
        } catch (Exception ignored) {
            try {
                node = json.readTree(stdout);
            } catch (Exception alsoFailed) {
                node = null;
            }
        }

        if (node == null || !node.path("ok").asBoolean(false)) {
            String reason = node != null ? node.path("error").asText("") : "";
            if (reason.isBlank()) reason = readTailFrom(stderr);
            log.warn("项目工程渲染失败 exit={} 原因={}", exitCode, reason);
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "render_failed",
                    "渲染失败：" + (reason.isBlank() ? "未得到可解析的输出" : reason));
        }

        if (!Files.isRegularFile(output)) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "render_failed",
                    "渲染脚本报告成功，但没有生成文件：" + output);
        }

        return new Result(
                output,
                node.path("durationInFrames").asInt(0),
                node.path("width").asInt(0),
                node.path("height").asInt(0),
                node.path("fps").asInt(0));
    }

    /**
     * 定位渲染脚本。
     *
     * @return 脚本路径
     */
    private Path resolveScript() {
        List<Path> candidates = new ArrayList<>();
        if (remotionDir != null && !remotionDir.isBlank()) {
            candidates.add(Path.of(remotionDir).resolve("render-project.mjs"));
        }
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        candidates.add(cwd.resolve("remotion").resolve("render-project.mjs"));

        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return candidate.toAbsolutePath().normalize();
            }
        }
        throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "renderer_unavailable",
                "找不到项目工程渲染脚本（配置项 fengmotion.remotion.project-dir）");
    }

    /**
     * 杀掉进程及其所有后代。
     *
     * @param process 进程
     */
    private void killTree(Process process) {
        if (process == null) return;
        process.descendants().forEach(ProcessHandle::destroyForcibly);
        process.destroyForcibly();
    }

    /**
     * 读日志尾部。
     *
     * @param file 文件
     * @return 末尾若干行
     */
    private String readTail(Path file) {
        try {
            return readTailFrom(Files.readString(file, StandardCharsets.UTF_8));
        } catch (IOException unreadable) {
            return "";
        }
    }

    /**
     * 取文本最后几行。
     *
     * @param text 文本
     * @return 末尾最多 800 字
     */
    private String readTailFrom(String text) {
        String trimmed = text == null ? "" : text.trim();
        return trimmed.length() <= 800 ? trimmed : trimmed.substring(trimmed.length() - 800);
    }

    /**
     * 静默删除。
     *
     * @param path 路径
     */
    private void deleteQuietly(Path path) {
        if (path == null) return;
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
            // 清理失败不影响结果
        }
    }

    /**
     * 渲染结果。
     *
     * @param output           产物路径
     * @param durationInFrames 时长帧数
     * @param width            宽
     * @param height           高
     * @param fps              帧率
     */
    public record Result(Path output, int durationInFrames, int width, int height, int fps) {
    }
}
