package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 新建项目时的目录重名处理。
 *
 * <p>这一组盯的是一个真实故障：前端「新建项目」固定用「未命名项目」当名字，
 * 而目录名由名称推导 —— 于是第二次新建就报「项目目录已存在」，
 * 用户从此建不出新项目。目录名重复是正常现象，不该等同于冲突。</p>
 */
@DisplayName("项目目录重名")
class ProjectDirectoryCollisionTest {

    /** 临时工作区。 */
    @TempDir
    Path workspace;

    private final ProjectDirectoryService service = new ProjectDirectoryService();

    @Test
    @DisplayName("默认目录重名时自动避让，不覆盖已有目录")
    void defaultPathAvoidsCollision() throws Exception {
        Path first = service.createAvoidingCollision(workspace.resolve("未命名项目"), false);
        assertEquals("未命名项目", first.getFileName().toString());

        Path second = service.createAvoidingCollision(workspace.resolve("未命名项目"), false);
        assertEquals("未命名项目-2", second.getFileName().toString(),
                "第二个同名项目应该落到 未命名项目-2");

        Path third = service.createAvoidingCollision(workspace.resolve("未命名项目"), false);
        assertEquals("未命名项目-3", third.getFileName().toString());

        /* 已有目录不能被覆盖：它可能正是别人正在用的项目 */
        assertTrue(Files.isDirectory(first) && Files.isDirectory(second) && Files.isDirectory(third));
        assertTrue(Files.isRegularFile(first.resolve("AGENTS.md")), "每个新目录都要有 agent 指引");
    }

    @Test
    @DisplayName("显式指定路径重名时报冲突，不悄悄换位置")
    void explicitPathStillFails() throws Exception {
        Path explicit = workspace.resolve("我指定的目录");
        service.createAvoidingCollision(explicit, true);

        assertThrows(FileAlreadyExistsException.class,
                () -> service.createAvoidingCollision(explicit, true),
                "用户点名的路径被占用就是冲突，换到别处更糟");
    }

    @Test
    @DisplayName("残留目录（只有 AGENTS.md）不再永久阻塞新建")
    void leftoverDirectoryDoesNotBlockForever() throws Exception {
        /* 真实场景：init 失败留下了一个非空目录，删除清不掉。
           旧逻辑下每次新建都撞它，用户从此建不出项目。 */
        Path leftover = workspace.resolve("未命名项目");
        Files.createDirectories(leftover);
        Files.writeString(leftover.resolve("AGENTS.md"), "# 残留");

        Path created = service.createAvoidingCollision(workspace.resolve("未命名项目"), false);
        assertEquals("未命名项目-2", created.getFileName().toString());
        assertTrue(Files.isRegularFile(created.resolve("AGENTS.md")));
    }
}
