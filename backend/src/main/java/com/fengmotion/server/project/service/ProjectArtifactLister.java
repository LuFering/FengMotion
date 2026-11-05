package com.fengmotion.server.project.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 列出项目目录里真实存在的文件。
 *
 * <p><strong>为什么要有它</strong>：界面「产物」页原先渲染的是前端写死的示例
 * （Token 科普、视觉方向、导演处理、质量证据），打开任何项目都显示同样几条 ——
 * 用户会把这些当成自己项目的产出。数据源必须是磁盘。</p>
 *
 * <p><strong>为什么跳过一部分目录</strong>：{@code node_modules}、{@code .git}
 * 动辄上万文件，列出来既没用又慢；它们是依赖与版本库，不是创作产物。</p>
 *
 * <p><strong>读不到就说读不到</strong>：项目没有目录、目录被删都如实返回空清单，
 * 不编造内容。空清单在界面上是「还没有产物」，与「有产物」是两回事。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProjectArtifactLister {

    /** 不参与列举的目录：依赖、缓存、版本库。 */
    private static final List<String> SKIP_DIRS = List.of(
            "node_modules", ".git", ".cache", ".remotion", "dist", "build");

    /** 单次列举上限：防止扫到异常目录时把响应撑爆。 */
    private static final int MAX_ITEMS = 500;

    private final ProjectRepository projects;

    /**
     * 一个项目产物文件。
     *
     * @param path       相对项目根的路径
     * @param name       文件名
     * @param sizeBytes  字节数
     * @param kind       归类：video / image / audio / code / document / file
     * @param modifiedAt 最后修改时间
     */
    public record Artifact(String path, String name, long sizeBytes, String kind, String modifiedAt) {
    }

    /**
     * 产物清单。
     *
     * @param items    文件列表
     * @param rootPath 项目根目录；项目还没有目录时为 null
     */
    public record Listing(List<Artifact> items, String rootPath) {
    }

    /**
     * 列出某个项目的文件。
     *
     * @param projectId 项目 ID
     * @return 清单
     * @throws ApiException 项目不存在时
     */
    public Listing list(String projectId) {
        Project project = projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        String rootPath = project.rootPath();
        if (rootPath == null || rootPath.isBlank()) {
            return new Listing(List.of(), null);
        }
        Path root = Path.of(rootPath).toAbsolutePath().normalize();
        if (!Files.isDirectory(root)) {
            /* 目录被删/被移走：如实返回空，不要假装有很多文件 */
            log.warn("项目目录不存在：{}", root);
            return new Listing(List.of(), root.toString());
        }

        List<Artifact> items = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(root, 3)) {
            for (Path file : walk.toList()) {
                if (!Files.isRegularFile(file)) continue;
                if (insideSkipped(root, file)) continue;
                items.add(new Artifact(
                        root.relativize(file).toString().replace('\\', '/'),
                        file.getFileName().toString(),
                        size(file),
                        kindOf(file.getFileName().toString()),
                        modified(file)));
                if (items.size() >= MAX_ITEMS) break;
            }
        } catch (IOException unreadable) {
            log.warn("列举项目文件失败：{}", root, unreadable);
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error",
                    "读取项目目录失败：" + unreadable.getMessage());
        }

        /* 视频排前面：用户最想看到的是「有没有出片」，而不是 package-lock.json。 */
        items.sort(Comparator
                .comparingInt((Artifact a) -> "video".equals(a.kind()) ? 0 : 1)
                .thenComparing(Artifact::path));
        return new Listing(items, root.toString());
    }

    /**
     * 判断文件是否落在被跳过的目录里。
     *
     * @param root 项目根
     * @param file 文件
     * @return 应跳过时 true
     */
    private boolean insideSkipped(Path root, Path file) {
        Path relative = root.relativize(file);
        for (Path segment : relative) {
            if (SKIP_DIRS.contains(segment.toString())) return true;
        }
        return false;
    }

    /**
     * 按扩展名归类。
     *
     * @param name 文件名
     * @return 类别
     */
    private String kindOf(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".mp4") || lower.endsWith(".webm") || lower.endsWith(".mov")
                || lower.endsWith(".mkv")) {
            return "video";
        }
        if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg")
                || lower.endsWith(".webp") || lower.endsWith(".gif") || lower.endsWith(".svg")) {
            return "image";
        }
        if (lower.endsWith(".mp3") || lower.endsWith(".wav") || lower.endsWith(".m4a")
                || lower.endsWith(".flac") || lower.endsWith(".aac")) {
            return "audio";
        }
        if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js")
                || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".css")) {
            return "code";
        }
        if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".json")
                || lower.endsWith(".yaml") || lower.endsWith(".yml")) {
            return "document";
        }
        return "file";
    }

    private long size(Path file) {
        try {
            return Files.size(file);
        } catch (IOException ex) {
            return -1;
        }
    }

    private String modified(Path file) {
        try {
            return Files.getLastModifiedTime(file).toInstant().toString();
        } catch (IOException ex) {
            return Instant.EPOCH.toString();
        }
    }
}
