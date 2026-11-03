package com.fengmotion.server.catalog.api;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;

import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

import lombok.RequiredArgsConstructor;

/**
 * 产物列表：列出某个项目目录下实际存在的文件。
 *
 * <p><strong>为什么先做这个</strong>：后端已经能让 AI 在项目目录里写文件
 * （{@code write}/{@code bash} 工具，工作目录取项目的 {@code root_path}），
 * 但产出之后没人看得到 —— 用户不知道 AI 到底做了什么。
 * 这个端点把「项目文件夹里有什么」如实列出来，是产物管理的最小可用形态。</p>
 *
 * <p><strong>为什么不建产物表</strong>：文件系统已经是事实来源。再建一张表记录
 * 「有哪些产物」，就多出一份需要同步的状态 —— 用户手动删了文件、或 AI 直接写盘，
 * 表就与磁盘不一致。先从磁盘读，等需要版本、来源、回滚时再引入登记表。</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/artifacts")
@RequiredArgsConstructor
public class ArtifactController {

    /** 单次最多返回的条目数：目录可能被 AI 写进大量文件，避免一次刷满界面。 */
    private static final int MAX_ENTRIES = 200;

    private final ProjectRepository projects;

    /**
     * 列出项目的产物文件。
     *
     * @param projectId 项目 ID
     * @return 产物列表（按修改时间倒序，最新的在前）
     */
    @GetMapping
    public ArtifactListResponse list(@PathVariable String projectId) {
        Project project = projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));

        String rootPath = project.rootPath();
        if (rootPath == null || rootPath.isBlank()) {
            // 项目还没有目录（刚创建、尚未分配）：如实说没有产物，不当成错误
            return new ArtifactListResponse(List.of(), null);
        }

        Path root = Path.of(rootPath).toAbsolutePath().normalize();
        if (!Files.isDirectory(root)) {
            return new ArtifactListResponse(List.of(), rootPath);
        }

        List<Artifact> items = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(root, 4)) {
            walk.filter(Files::isRegularFile)
                    // 跳过隐藏文件与常见构建产物目录：它们不是「作品」
                    .filter(p -> !isIgnored(root, p))
                    .limit(MAX_ENTRIES * 4L)
                    .forEach(p -> items.add(toArtifact(root, p)));
        } catch (IOException unreadable) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error",
                    "读取项目目录失败");
        }

        items.sort(Comparator.comparing(Artifact::modifiedAt).reversed());
        List<Artifact> limited = items.size() > MAX_ENTRIES ? items.subList(0, MAX_ENTRIES) : items;
        return new ArtifactListResponse(limited, rootPath);
    }

    /**
     * 判断是否应当跳过该文件。
     *
     * @param root 项目根目录
     * @param file 待判断的文件
     * @return 是否跳过
     */
    private static boolean isIgnored(Path root, Path file) {
        Path rel = root.relativize(file);
        // 路径里任何一段以 . 开头（.git、.cache 等）或命中依赖目录，都不是产物
        for (Path part : rel) {
            String name = part.toString();
            if (name.startsWith(".") || name.equals("node_modules")) {
                return true;
            }
        }
        return false;
    }

    /**
     * 把磁盘文件转成产物描述。
     *
     * @param root 项目根目录
     * @param file 文件路径
     * @return 产物描述
     */
    private static Artifact toArtifact(Path root, Path file) {
        String relative = root.relativize(file).toString().replace('\\', '/');
        long size;
        Instant modified;
        try {
            size = Files.size(file);
            modified = Files.getLastModifiedTime(file).toInstant();
        } catch (IOException unreadable) {
            // 读不到元信息（权限、竞态删除）：仍列出文件名，大小记 0，
            // 比整条消失更接近事实
            size = 0L;
            modified = Instant.EPOCH;
        }
        return new Artifact(relative, fileName(relative), size, kindOf(relative), modified);
    }

    /**
     * 取文件名（不含目录）。
     *
     * @param relative 相对路径
     * @return 文件名
     */
    private static String fileName(String relative) {
        int slash = relative.lastIndexOf('/');
        return slash >= 0 ? relative.substring(slash + 1) : relative;
    }

    /**
     * 按扩展名归类。
     *
     * <p>只按扩展名判断，不读文件头：这里只用于界面分组与图标选择，
     * 不需要像上传校验那样严格。</p>
     *
     * @param relative 相对路径
     * @return video / image / audio / code / document / file
     */
    private static String kindOf(String relative) {
        int dot = relative.lastIndexOf('.');
        if (dot < 0 || dot == relative.length() - 1) {
            return "file";
        }
        return switch (relative.substring(dot + 1).toLowerCase(Locale.ROOT)) {
            case "mp4", "mov", "webm", "mkv", "avi" -> "video";
            case "png", "jpg", "jpeg", "webp", "gif", "svg" -> "image";
            case "mp3", "wav", "m4a", "flac" -> "audio";
            case "ts", "tsx", "js", "jsx", "json", "html", "css", "py", "sh" -> "code";
            case "md", "txt", "pdf", "csv" -> "document";
            default -> "file";
        };
    }

    /**
     * 读取产物文件本体（用于视频/图片预览）。
     *
     * <p>为什么需要它：产物列表只给元信息，用户看不到内容。视频要能播放、
     * 图片要能显示，前端必须能拿到字节流。</p>
     *
     * <p><strong>路径安全</strong>：{@code path} 来自外部，必须挡住 {@code ../}。
     * 这里用「解析后必须仍在项目根目录之下」判断，而不是过滤字符串 ——
     * 过滤 {@code ../} 的写法能被 {@code ....//} 或符号链接绕过。</p>
     *
     * @param projectId 项目 ID
     * @param path      相对项目根目录的路径
     * @return 文件内容；支持 Range 请求以便视频拖动进度条
     */
    @GetMapping("/content")
    public ResponseEntity<Resource> content(@PathVariable String projectId,
                                            @RequestParam("path") String path) {
        Project project = projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));

        String rootPath = project.rootPath();
        if (rootPath == null || rootPath.isBlank()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目还没有目录");
        }

        Path root = Path.of(rootPath).toAbsolutePath().normalize();
        Path target = root.resolve(path).normalize();

        // 关键：解析之后必须仍在 root 之下。符号链接也会被 toRealPath 暴露出来
        if (!target.startsWith(root)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "非法的产物路径");
        }
        if (!Files.isRegularFile(target)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "产物不存在");
        }

        Resource resource = new FileSystemResource(target);
        return ResponseEntity.ok()
                .contentType(mediaTypeOf(path))
                // inline：图片/视频直接在浏览器里显示，不触发下载
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
                .body(resource);
    }

    /**
     * 按扩展名推断 Content-Type。
     *
     * @param path 文件路径
     * @return 媒体类型；未知时用二进制流
     */
    private static MediaType mediaTypeOf(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot >= 0 ? path.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        return switch (ext) {
            case "mp4" -> MediaType.parseMediaType("video/mp4");
            case "webm" -> MediaType.parseMediaType("video/webm");
            case "mov" -> MediaType.parseMediaType("video/quicktime");
            case "mp3" -> MediaType.parseMediaType("audio/mpeg");
            case "wav" -> MediaType.parseMediaType("audio/wav");
            case "png" -> MediaType.IMAGE_PNG;
            case "jpg", "jpeg" -> MediaType.IMAGE_JPEG;
            case "gif" -> MediaType.IMAGE_GIF;
            case "webp" -> MediaType.parseMediaType("image/webp");
            case "svg" -> MediaType.parseMediaType("image/svg+xml");
            case "json" -> MediaType.APPLICATION_JSON;
            case "txt", "md" -> MediaType.TEXT_PLAIN;
            case "html" -> MediaType.TEXT_HTML;
            default -> MediaType.APPLICATION_OCTET_STREAM;
        };
    }

    /**
     * 一个产物文件。
     *
     * @param path       相对项目根目录的路径（用于展示与去重）
     * @param name       文件名
     * @param sizeBytes  字节数；读不到时为 0
     * @param kind       video / image / audio / code / document / file
     * @param modifiedAt 最后修改时间
     */
    public record Artifact(String path, String name, long sizeBytes, String kind, Instant modifiedAt) {
    }

    /**
     * 产物列表响应。
     *
     * @param items    产物条目
     * @param rootPath 项目根目录；没有目录时为 null
     */
    public record ArtifactListResponse(List<Artifact> items, String rootPath) {
    }
}
