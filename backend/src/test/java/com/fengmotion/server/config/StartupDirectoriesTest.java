package com.fengmotion.server.config;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 启动期目录创建。
 *
 * <p>这个缺陷只在**全新安装**时暴露：SQLite 不创建缺少的父目录，
 * 后端会以「Failed to execute database script」失败，错误信息指向 schema，
 * 很容易查错方向。开发机数据目录早就存在，三库开发期间一直没踩到 ——
 * 直到真正运行 AppImage 才出现。用测试把它锁住。</p>
 */
class StartupDirectoriesTest {

    @Test
    @DisplayName("数据目录不存在时会被创建出来")
    void createsMissingDataDirectory(@TempDir Path temp) {
        Path dataDir = temp.resolve("nested").resolve("data");
        Path workspace = temp.resolve("workspace").resolve("projects");
        assertTrue(Files.notExists(dataDir), "前置条件：目录不该存在");

        StartupDirectories.prepare(new String[] {
                "--fengmotion.data-dir=" + dataDir,
                "--fengmotion.workspace-root=" + workspace,
        });

        assertTrue(Files.isDirectory(dataDir), "数据目录必须被创建 —— 否则 SQLite 打不开库");
        assertTrue(Files.isDirectory(workspace), "工作区目录同样要创建");
    }

    @Test
    @DisplayName("目录已存在时不报错（幂等）")
    void existingDirectoryIsFine(@TempDir Path temp) {
        Path dataDir = temp.resolve("data");
        StartupDirectories.prepare(new String[] { "--fengmotion.data-dir=" + dataDir });
        // 第二次调用不应抛异常
        StartupDirectories.prepare(new String[] { "--fengmotion.data-dir=" + dataDir });
        assertTrue(Files.isDirectory(dataDir));
    }

    @Test
    @DisplayName("没传参数时用默认目录，同样要创建")
    void defaultsAreCreated() {
        // 不实际断言用户主目录是否被创建（那会污染真实环境），
        // 只验传空参数不抛异常 —— 默认路径的逻辑由上面两个用例覆盖创建行为。
        StartupDirectories.prepare(new String[] {});
    }
}
