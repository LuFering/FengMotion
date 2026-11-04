package com.fengmotion.server.catalog.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 用统一的 Remotion 工程把「场景数据」渲染成 mp4。
 *
 * <p><strong>为什么是一个统一工程</strong>：每个项目单独装一套 Remotion 依赖，
 * 磁盘与安装时间会随项目数线性增长，版本也容易漂移。这里所有项目共用一个工程，
 * 差异全部通过 JSON props 表达 —— AI 只产出一份场景数据，不碰工程配置。</p>
 *
 * <p><strong>为什么用子进程而不是内嵌 JS 引擎</strong>：Remotion 渲染要起
 * Chromium 逐帧截图，是 CPU 密集且可能长时间运行的任务。放在独立进程里，
 * 超时可以整进程杀掉；跑在 JVM 里则没有可靠的中断手段。</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RemotionRenderer {

    /** 渲染超时：默认 10 分钟。长片或高分辨率会更久，可通过配置调整。 */
    @Value("${fengmotion.remotion.timeout-seconds:600}")
    private long timeoutSeconds;

    /** Node 可执行文件。 */
    @Value("${fengmotion.remotion.node:node}")
    private String nodeBinary;

    /** 统一工程所在目录（含 render.mjs 与 src/）。 */
    @Value("${fengmotion.remotion.project-dir:}")
    private String projectDir;

    /** Remotion 依赖所在目录（复用桌面端的 node_modules，避免再装一套）。 */
    @Value("${fengmotion.remotion.node-modules:}")
    private String nodeModulesDir;

    /** Chromium 可执行文件；留空则由 Remotion 自行下载。 */
    @Value("${fengmotion.remotion.browser:}")
    private String browserExecutable;

    /** 浏览器缓存目录：不传则每次渲染都会重下 chrome-headless-shell。 */
    @Value("${fengmotion.remotion.browser-cache:}")
    private String browserCacheDir;

    private final ObjectMapper json;

    /**
     * 渲染结果。
     *
     * @param outputPath    产物绝对路径
     * @param durationInFrames 总帧数
     * @param width         宽
     * @param height        高
     * @param fps           帧率
     */
    public record RenderResult(String outputPath, int durationInFrames, int width, int height, int fps) {
    }

    /**
     * 把场景数据渲染成 mp4。
     *
     * @param film      影片数据（含 scenes/width/height/fps）
     * @param outputFile 输出文件绝对路径
     * @return 渲染结果
     * @throws ApiException 工程不可用、超时或渲染失败时抛出
     */
    public RenderResult render(JsonNode film, Path outputFile) {
        Path project = resolveProjectDir();
        String script = project.resolve("render.mjs").toString();

        Path propsFile = null;
        Path stdoutFile = null;
        Path stderrFile = null;
        try {
            Files.createDirectories(outputFile.getParent());
            // props 走临时文件而不是命令行参数：场景数据可能很长，
            // 命令行长度有系统上限，且引号转义极易出错
            propsFile = Files.createTempFile("fm-film-", ".json");
            Files.writeString(propsFile, film.toString(), StandardCharsets.UTF_8);

            List<String> command = new ArrayList<>();
            command.add(nodeBinary);
            command.add(script);
            command.add("--props");
            command.add(propsFile.toString());
            command.add("--out");
            command.add(outputFile.toString());
            if (browserExecutable != null && !browserExecutable.isBlank()) {
                command.add("--browser");
                command.add(browserExecutable);
            }

            // 使用文件接收两路输出，避免管道写满，也无需在计时等待前阻塞读取。
            stdoutFile = Files.createTempFile("fm-render-stdout-", ".log");
            stderrFile = Files.createTempFile("fm-render-stderr-", ".log");
            ProcessBuilder builder = new ProcessBuilder(command)
                    .directory(project.toFile())
                    .redirectOutput(stdoutFile.toFile())
                    .redirectError(stderrFile.toFile());
            if (nodeModulesDir != null && !nodeModulesDir.isBlank()) {
                builder.environment().put("FENGMOTION_NODE_MODULES", nodeModulesDir);
            }
            if (browserCacheDir != null && !browserCacheDir.isBlank()) {
                builder.environment().put("FENGMOTION_BROWSER_CACHE", browserCacheDir);
            }

            Process process = builder.start();
            try {
                if (!process.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
                    throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "render_timeout",
                            "渲染超时（超过 " + timeoutSeconds + " 秒）");
                }
            } finally {
                if (process.isAlive()) {
                    process.descendants().forEach(ProcessHandle::destroyForcibly);
                    process.destroyForcibly();
                }
            }
            String stdout = Files.readString(stdoutFile, StandardCharsets.UTF_8).trim();
            String stderr = Files.readString(stderrFile, StandardCharsets.UTF_8).trim();
            log.info("render：node={} project={} stdout长度={} stderr长度={}",
                    nodeBinary, project, stdout.length(), stderr.length());
            return parseResult(stdout, stderr, outputFile);
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "render_failed",
                    "无法启动渲染进程：" + failure.getMessage());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "render_failed", "渲染被中断");
        } finally {
            for (Path temporary : new Path[] {propsFile, stdoutFile, stderrFile}) {
                if (temporary == null) continue;
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    // 临时文件删不掉不影响结果
                }
            }
        }
    }

    /**
     * 解析渲染脚本的输出。
     *
     * @param stdout     标准输出，应为一行 JSON
     * @param stderr     标准错误，失败时用于说明原因
     * @param outputFile 期望的产物路径
     * @return 渲染结果
     */
    private RenderResult parseResult(String stdout, String stderr, Path outputFile) {
        JsonNode result;
        if (stdout.isEmpty()) {
            /* 空 stdout 不是「JSON 写坏了」，而是脚本没给出结果就退出了。
               报「无法解析」会把方向指错（代码本身没问题），
               所以这里如实说「没有输出」并把退出原因带出来。 */
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "render_failed",
                    "渲染脚本没有输出结果：" + tail(stderr, 400));
        }
        try {
            result = json.readTree(stdout);
        } catch (IOException malformed) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "render_failed",
                    "渲染脚本输出不是合法 JSON：" + tail(stderr, 400));
        }

        if (!result.path("ok").asBoolean(false)) {
            String reason = result.path("error").asText(tail(stderr, 400));
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "render_failed",
                    "渲染失败：" + reason);
        }
        if (!Files.isRegularFile(outputFile)) {
            // 脚本说成功但没有文件：不能当成功返回，否则前端会拿到一个打不开的地址
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "render_failed",
                    "渲染报告成功但没有产出文件");
        }

        return new RenderResult(
                outputFile.toString(),
                result.path("durationInFrames").asInt(0),
                result.path("width").asInt(0),
                result.path("height").asInt(0),
                result.path("fps").asInt(0));
    }

    /**
     * 取文本尾部若干字符，用于错误信息（完整日志太长，塞进响应不合适）。
     *
     * @param text  原文
     * @param limit 上限
     * @return 截断后的文本
     */
    private static String tail(String text, int limit) {
        if (text == null || text.isEmpty()) {
            return "（无详细输出）";
        }
        return text.length() <= limit ? text : "…" + text.substring(text.length() - limit);
    }

    /**
     * 定位统一 Remotion 工程目录。
     *
     * @return 工程绝对路径
     */
    private Path resolveProjectDir() {
        String configured = projectDir == null ? "" : projectDir.trim();
        if (!configured.isEmpty()) {
            Path path = Path.of(configured).toAbsolutePath().normalize();
            if (Files.isRegularFile(path.resolve("render.mjs"))) {
                return path;
            }
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "renderer_unavailable",
                    "配置的渲染工程缺少 render.mjs：" + path);
        }
        // 开发态默认：后端仓库下的 remotion/
        Path fallback = Path.of(System.getProperty("user.dir")).resolve("remotion").toAbsolutePath().normalize();
        if (Files.isRegularFile(fallback.resolve("render.mjs"))) {
            return fallback;
        }
        throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "renderer_unavailable",
                "找不到 Remotion 渲染工程（配置项 fengmotion.remotion.project-dir）");
    }
}
