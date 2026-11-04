package com.fengmotion.server.asset.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 缩略图与元数据提取。
 *
 * <p>两条独立能力，<strong>失败语义不同，不能混在一起</strong>：</p>
 * <ul>
 *   <li><b>元数据</b>（宽高、时长）：有 ffprobe 就用 ffprobe，没有就尝试从容器头解析；
 *       读不到就留空。<strong>留空是合法结果</strong> —— 界面显示「未知」比显示 0×0 诚实。</li>
 *   <li><b>缩略图</b>：需要 ffmpeg 抽帧。没有 ffmpeg 时不生成，如实返回 null，
 *       界面回退到类型图标。<strong>绝不画一张假的占位图冒充缩略图</strong>。</li>
 * </ul>
 *
 * <p>为什么用系统 ffmpeg 而不是 Java 图像库：解码 H.264 需要完整解码器，
 * 纯 Java 方案要么引入几十 MB 的本地库，要么只支持少数格式。ffmpeg 是这类工具的
 * 事实标准，且后端已经通过配置注入外部二进制（见 {@code RemotionRenderer}），
 * 沿用同一模式即可，打包时随 resources 一起带。</p>
 */
@Service
public class ThumbnailService {

    private static final Logger log = LoggerFactory.getLogger(ThumbnailService.class);

    /** 缩略图宽度（像素）。480 是 2 倍于卡片显示宽度的值，高分屏也够清晰。 */
    static final int THUMB_WIDTH = 480;

    /** 抽帧超时：单个短视频几百毫秒，这里给足余量但不允许无限等。 */
    private static final int FFMPEG_TIMEOUT_SECONDS = 30;

    /** 抽帧位置（秒）：跳过开头往往是黑场或过渡帧。 */
    private static final double FRAME_AT_SECONDS = 1.0;

    private final String ffmpeg;
    private final String ffprobe;

    public ThumbnailService(
            @Value("${fengmotion.asset.ffmpeg:ffmpeg}") String ffmpeg,
            @Value("${fengmotion.asset.ffprobe:ffprobe}") String ffprobe) {
        this.ffmpeg = ffmpeg;
        this.ffprobe = ffprobe;
    }

    /** 视频/音频的实测元数据。读不到的字段为 null。 */
    public record MediaInfo(Integer width, Integer height, Long durationMs) {
    }

    /**
     * 读取音视频元数据。
     *
     * <p>失败返回 null 而不是抛异常：素材本身的导入不该因为「读不出时长」而失败。</p>
     *
     * @param file 文件本体
     * @return 元数据；探测不可用时返回 null
     */
    public MediaInfo probe(Path file) {
        if (!Files.isReadable(file)) {
            return null;
        }
        try {
            // -v error：只要错误输出，别把进度信息混进来
            // -select_streams v:0 取第一个视频流；音频文件没有视频流，退回整段信息
            List<String> command = List.of(ffprobe, "-v", "error", "-select_streams", "v:0",
                    "-show_entries", "stream=width,height:format=duration",
                    "-of", "default=noprint_wrappers=1", file.toString());
            String output = run(command);
            if (output == null) {
                return probeAudio(file);
            }
            Integer width = null;
            Integer height = null;
            Long durationMs = null;
            for (String line : output.split("\n")) {
                String[] pair = line.trim().split("=", 2);
                if (pair.length != 2) {
                    continue;
                }
                switch (pair[0]) {
                    case "width" -> width = parseInteger(pair[1]);
                    case "height" -> height = parseInteger(pair[1]);
                    case "duration" -> durationMs = parseDurationMs(pair[1]);
                    default -> { }
                }
            }
            if (width == null && height == null && durationMs == null) {
                return probeAudio(file);
            }
            return new MediaInfo(width, height, durationMs);
        } catch (IOException | InterruptedException ex) {
            if (ex instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            log.debug("探测元数据失败：{}", file, ex);
            return null;
        }
    }

    /** 音频没有视频流，单独取容器时长。 */
    private MediaInfo probeAudio(Path file) {
        try {
            List<String> command = List.of(ffprobe, "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1", file.toString());
            String output = run(command);
            if (output == null) {
                return null;
            }
            for (String line : output.split("\n")) {
                String[] pair = line.trim().split("=", 2);
                if (pair.length == 2 && "duration".equals(pair[0])) {
                    return new MediaInfo(null, null, parseDurationMs(pair[1]));
                }
            }
        } catch (IOException | InterruptedException ex) {
            if (ex instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
        }
        return null;
    }

    /**
     * 给视频抽一帧作缩略图。
     *
     * @param video 视频文件
     * @param target 输出文件（WebP）
     * @return 是否成功；ffmpeg 不可用或抽帧失败都返回 false，由调用方回退到图标
     */
    public boolean extractVideoThumbnail(Path video, Path target) {
        if (!Files.isReadable(video)) {
            return false;
        }
        try {
            Files.createDirectories(target.getParent());
            List<String> command = List.of(ffmpeg, "-y", "-v", "error",
                    // 先 -ss 再 -i：快速定位，不用解码整段
                    "-ss", String.valueOf(FRAME_AT_SECONDS),
                    "-i", video.toString(),
                    "-frames:v", "1",
                    // scale=480:-2 保持宽高比，-2 保证高度是偶数（编码器要求）
                    "-vf", "scale=" + THUMB_WIDTH + ":-2",
                    target.toString());
            run(command);
            return Files.isRegularFile(target) && Files.size(target) > 0;
        } catch (IOException | InterruptedException ex) {
            if (ex instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            log.debug("抽帧失败：{}", video, ex);
            return false;
        }
    }

    /**
     * 给图片生成缩略图。
     *
     * <p>图片没有「抽帧」的概念，直接缩放即可。ffmpeg 对图片同样适用，
     * 不必为它单独引入图像处理库。</p>
     */
    public boolean extractImageThumbnail(Path image, Path target) {
        if (!Files.isReadable(image)) {
            return false;
        }
        try {
            Files.createDirectories(target.getParent());
            List<String> command = List.of(ffmpeg, "-y", "-v", "error",
                    "-i", image.toString(),
                    "-frames:v", "1",
                    // 只缩不放：宽度小于目标时不放大，避免糊成一片
                    "-vf", "scale='min(" + THUMB_WIDTH + ",iw)':-2",
                    target.toString());
            run(command);
            return Files.isRegularFile(target) && Files.size(target) > 0;
        } catch (IOException | InterruptedException ex) {
            if (ex instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            log.debug("图片缩略图失败：{}", image, ex);
            return false;
        }
    }

    /** 当前环境是否真的能抽帧（用于在启动日志与诊断里如实说明能力）。 */
    public boolean ffmpegAvailable() {
        try {
            return run(List.of(ffmpeg, "-version")) != null;
        } catch (IOException | InterruptedException ex) {
            if (ex instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return false;
        }
    }

    /**
     * 运行外部命令并收集 stdout。
     *
     * <p>重定向到临时文件而不是管道：ffmpeg 的输出量可能很大，管道写满会让子进程阻塞，
     * 而父进程在等它退出 —— 双方互等形成死锁。这与项目里渲染调用踩过的坑一致。</p>
     *
     * @return stdout 内容；命令失败或超时返回 null
     */
    private String run(List<String> command) throws IOException, InterruptedException {
        Path out = Files.createTempFile("fengmotion-probe-", ".txt");
        Path err = Files.createTempFile("fengmotion-probe-err-", ".txt");
        try {
            ProcessBuilder builder = new ProcessBuilder(command)
                    .redirectOutput(out.toFile())
                    .redirectError(err.toFile());
            Process process = builder.start();
            if (!process.waitFor(FFMPEG_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
                log.warn("外部命令超时：{}", command.get(0));
                return null;
            }
            if (process.exitValue() != 0) {
                String error = Files.readString(err, StandardCharsets.UTF_8);
                log.debug("外部命令失败（{}）：{}", process.exitValue(), error.strip());
                return null;
            }
            return Files.readString(out, StandardCharsets.UTF_8);
        } finally {
            Files.deleteIfExists(out);
            Files.deleteIfExists(err);
        }
    }

    private static Integer parseInteger(String value) {
        try {
            int parsed = Integer.parseInt(value.trim());
            // 0 宽高没有意义（有些容器会写 0），当作未读到。
            return parsed > 0 ? parsed : null;
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private static Long parseDurationMs(String value) {
        try {
            double seconds = Double.parseDouble(value.trim());
            if (seconds <= 0 || Double.isNaN(seconds) || Double.isInfinite(seconds)) {
                return null;
            }
            return Math.round(seconds * 1000);
        } catch (NumberFormatException ex) {
            return null;
        }
    }
}
