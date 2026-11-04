package com.fengmotion.server.config;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 在 Spring 容器启动**之前**准备好数据目录与工作区目录。
 *
 * <p><strong>为什么不能做成 Bean</strong>：SQLite 在打开数据库时不会创建缺少的父目录，
 * 而数据源初始化发生在 bean 创建的最早期（`@Value` 注入的组件都还没轮到）。
 * 做成 Component 也来不及 —— 实测仍会以
 * {@code path to '.../fengmotion.db': '...' does not exist} 失败。
 * 所以必须在 {@code main} 里、{@code SpringApplication.run} 之前完成。</p>
 *
 * <p>这个缺陷只在**全新安装**时暴露：开发机的数据目录早就存在，三库开发期间一直没踩到，
 * 直到真正运行 AppImage 才出现 —— 后端完全起不来，而错误信息指向 schema，
 * 很容易误导排查方向。</p>
 */
public final class StartupDirectories {

    private static final Logger log = LoggerFactory.getLogger(StartupDirectories.class);

    private StartupDirectories() {
    }

    /**
     * 从命令行参数里取出目录配置并创建。
     *
     * <p>只认 {@code --key=value} 形式（Spring Boot 的标准写法，桌面壳也用这种）。
     * 没传的项交给默认值，同样要创建 —— 默认值也落在用户目录下，首次运行同样不存在。</p>
     *
     * @param args 原始命令行参数
     */
    public static void prepare(String[] args) {
        String dataDir = findArg(args, "fengmotion.data-dir");
        String workspace = findArg(args, "fengmotion.workspace-root");
        // 与 application.yml 的默认值保持一致。
        if (dataDir == null) {
            dataDir = System.getProperty("user.home") + "/.config/FengMotion/data";
        }
        if (workspace == null) {
            workspace = System.getProperty("user.home") + "/FengMotion/projects";
        }
        create(dataDir, "数据目录");
        create(workspace, "工作区目录");
    }

    private static String findArg(String[] args, String key) {
        String prefix = "--" + key + "=";
        for (String arg : args) {
            if (arg.startsWith(prefix)) {
                String value = arg.substring(prefix.length()).trim();
                if (!value.isEmpty()) {
                    return value;
                }
            }
        }
        return null;
    }

    private static void create(String dir, String what) {
        if (dir == null || dir.isBlank()) {
            return;
        }
        Path path = Path.of(dir);
        try {
            if (!Files.exists(path)) {
                Files.createDirectories(path);
                log.info("已创建{}：{}", what, path);
            }
        } catch (IOException ex) {
            throw new UncheckedIOException("无法创建" + what + "：" + path, ex);
        }
    }
}
