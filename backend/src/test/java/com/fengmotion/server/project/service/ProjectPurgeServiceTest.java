package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.store.ProjectPurgeRepository;

/**
 * 物理删除项目。
 *
 * <p>这一组盯的是删除操作里最要命的两类错误：</p>
 * <ol>
 *   <li><strong>删错目录</strong>：{@code root_path} 是数据库里的一列，
 *       被改坏或来自旧迁移时可能指向工作区之外。这道防线一旦失效，
 *       「删项目」就等于「删任意目录」。</li>
 *   <li><strong>删到一半</strong>：任务还在跑时删目录，渲染进程正在往里写，
 *       结果是半截文件加一个失败的任务。</li>
 * </ol>
 */
@DisplayName("物理删除项目")
class ProjectPurgeServiceTest {

    /** 临时工作区根。 */
    @TempDir
    Path workspace;

    private final ProjectPurgeRepository repository = mock(ProjectPurgeRepository.class);
    private final ProjectDirectoryService directoryService = new ProjectDirectoryService();

    private ProjectPurgeService service;

    @BeforeEach
    void setUp() {
        service = new ProjectPurgeService(repository, directoryService);
        ReflectionTestUtils.setField(service, "workspaceRoot", workspace.toString());
    }

    /** 造一个项目目录，里面放两个文件。 */
    private Path seedProject(String name) throws Exception {
        Path dir = workspace.resolve(name);
        Files.createDirectories(dir.resolve("renders"));
        Files.writeString(dir.resolve("prompt.original.md"), "做一个 5 秒的片子");
        Files.writeString(dir.resolve("renders/out.mp4"), "fake-video");
        return dir;
    }
    @Test
    @DisplayName("删除后目录消失、数据库记录被清掉")
    void deletesDirectoryAndRows() throws Exception {
        Path dir = seedProject("待删项目");
        when(repository.findRootPath("p1")).thenReturn(Optional.of(dir.toString()));
        when(repository.countRunningTasks("p1")).thenReturn(0);
        when(repository.deleteProjectGraph("p1")).thenReturn(1);

        service.purge("p1");

        assertFalse(Files.exists(dir), "项目目录应该被真正删掉");
        verify(repository).deleteProjectGraph("p1");
    }

    @Test
    @DisplayName("目录在工作区之外时拒绝删除，目录保持原样")
    void refusesPathOutsideWorkspace() throws Exception {
        /* 模拟数据库里的 root_path 被改坏，指向工作区之外。
           那个目录没有本项目的身份标记 —— 说明它不是这个项目的目录。 */
        Path outside = Files.createTempDirectory("outside");
        Path victim = outside.resolve("重要文件.txt");
        Files.writeString(victim, "不能删");
        when(repository.findRootPath("p1")).thenReturn(Optional.of(outside.toString()));
        when(repository.countRunningTasks("p1")).thenReturn(0);

        ApiException error = assertThrows(ApiException.class, () -> service.purge("p1"));

        assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
        assertTrue(Files.exists(victim), "工作区外的文件绝不能被删");
        verify(repository, never()).deleteProjectGraph(anyString());
    }

    @Test
    @DisplayName("工作区外的项目，只要身份标记对得上就允许删除")
    void allowsOutsideWorkspaceWithMatchingIdentity() throws Exception {
        /* 用户可以把项目建在任意位置（创建接口支持显式 rootPath）。
           这种项目不在工作区内，但目录自证身份 —— 不能因此删不掉。 */
        Path outside = Files.createTempDirectory("outside");
        Path dir = outside.resolve("我的项目");
        Files.createDirectories(dir);
        directoryService.writeIdentity(dir, "p1", "我的项目");
        when(repository.findRootPath("p1")).thenReturn(Optional.of(dir.toString()));
        when(repository.countRunningTasks("p1")).thenReturn(0);
        when(repository.deleteProjectGraph("p1")).thenReturn(1);

        service.purge("p1");

        assertFalse(Files.exists(dir), "身份对得上的项目目录应该被删掉");
        verify(repository).deleteProjectGraph("p1");
    }

    @Test
    @DisplayName("身份标记里的 ID 与请求不符时拒绝删除")
    void refusesMismatchedIdentity() throws Exception {
        Path outside = Files.createTempDirectory("outside");
        Path dir = outside.resolve("别人的项目");
        Files.createDirectories(dir);
        directoryService.writeIdentity(dir, "other-id", "别人的项目");
        when(repository.findRootPath("p1")).thenReturn(Optional.of(dir.toString()));
        when(repository.countRunningTasks("p1")).thenReturn(0);

        ApiException error = assertThrows(ApiException.class, () -> service.purge("p1"));

        assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
        assertTrue(Files.isDirectory(dir), "标记对不上的目录不能被删");
        verify(repository, never()).deleteProjectGraph(anyString());
    }

    @Test
    @DisplayName("root_path 指向工作区根本身时拒绝删除")
    void refusesWorkspaceRootItself() {
        when(repository.findRootPath("p1")).thenReturn(Optional.of(workspace.toString()));
        when(repository.countRunningTasks("p1")).thenReturn(0);

        ApiException error = assertThrows(ApiException.class, () -> service.purge("p1"));

        assertEquals(HttpStatus.BAD_REQUEST, error.getStatus());
        assertTrue(Files.isDirectory(workspace), "工作区根不能被当成项目目录删掉");
        verify(repository, never()).deleteProjectGraph(anyString());
    }

    @Test
    @DisplayName("还有任务在跑时拒绝删除，目录与数据都保留")
    void refusesWhileTasksRunning() throws Exception {
        Path dir = seedProject("忙碌项目");
        when(repository.findRootPath("p1")).thenReturn(Optional.of(dir.toString()));
        when(repository.countRunningTasks("p1")).thenReturn(2);
        when(repository.findRunningTaskLabels("p1")).thenReturn(List.of("task-1", "task-2"));

        ApiException error = assertThrows(ApiException.class, () -> service.purge("p1"));

        assertEquals(HttpStatus.CONFLICT, error.getStatus());
        assertTrue(Files.isDirectory(dir), "任务还在跑时目录不能被删");
        assertTrue(Files.exists(dir.resolve("renders/out.mp4")));
        verify(repository, never()).deleteProjectGraph(anyString());
    }

    @Test
    @DisplayName("目录已被手工删掉时，仍清掉数据库记录")
    void clearsRowsWhenDirectoryAlreadyGone() {
        when(repository.findRootPath("p1")).thenReturn(Optional.of(workspace.resolve("没了").toString()));
        when(repository.countRunningTasks("p1")).thenReturn(0);
        when(repository.deleteProjectGraph("p1")).thenReturn(1);

        service.purge("p1");

        verify(repository).deleteProjectGraph("p1");
    }

    @Test
    @DisplayName("项目不存在时报 404")
    void unknownProjectIsNotFound() {
        when(repository.findRootPath("nope")).thenReturn(Optional.empty());

        ApiException error = assertThrows(ApiException.class, () -> service.purge("nope"));

        assertEquals(HttpStatus.NOT_FOUND, error.getStatus());
    }
}
