package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

/**
 * 「产物」页的数据来源。
 *
 * <p>这组测试防的是一个真实故障：界面「产物」页原先渲染前端写死的示例
 * （Token 科普、视觉方向、导演处理、质量证据），而前端请求的
 * {@code /api/projects/{id}/artifacts} 后端从未实现。两边一凑，
 * 用户打开任何项目看到的都是同一批别人的产物。</p>
 */
@DisplayName("项目产物列举")
class ProjectArtifactListerTest {

    @TempDir
    Path projectRoot;

    /**
     * 造一个 lister，项目记录指向给定目录。
     *
     * @param rootPath 项目目录；null 表示项目还没有目录
     * @return lister
     */
    private ProjectArtifactLister listerFor(String rootPath) {
        ProjectRepository projects = mock(ProjectRepository.class);
        when(projects.findById("p1")).thenReturn(Optional.of(
                new Project("p1", "测试项目", null, null, rootPath, Instant.now())));
        return new ProjectArtifactLister(projects);
    }

    @Test
    @DisplayName("列出目录里真实存在的文件，视频排在前面")
    void listsRealFilesVideoFirst() throws Exception {
        Files.createDirectories(projectRoot.resolve("renders"));
        Files.createDirectories(projectRoot.resolve("src"));
        Files.writeString(projectRoot.resolve("renders/a.mp4"), "video");
        Files.writeString(projectRoot.resolve("src/index.tsx"), "code");
        Files.writeString(projectRoot.resolve("decisions.md"), "# 决策");

        var listing = listerFor(projectRoot.toString()).list("p1");

        assertEquals(3, listing.items().size());
        assertEquals("video", listing.items().get(0).kind(), "视频应排在第一位");
        assertEquals("renders/a.mp4", listing.items().get(0).path());
        assertEquals(projectRoot.toString(), listing.rootPath());
    }

    @Test
    @DisplayName("跳过 node_modules 等依赖目录")
    void skipsDependencyDirs() throws Exception {
        Files.createDirectories(projectRoot.resolve("node_modules/react"));
        Files.writeString(projectRoot.resolve("node_modules/react/index.js"), "dep");
        Files.createDirectories(projectRoot.resolve("renders"));
        Files.writeString(projectRoot.resolve("renders/a.mp4"), "video");

        var listing = listerFor(projectRoot.toString()).list("p1");

        assertEquals(1, listing.items().size(), "node_modules 里的文件不该算产物");
        assertFalse(listing.items().stream().anyMatch(a -> a.path().contains("node_modules")));
    }

    @Test
    @DisplayName("空项目返回空清单，不填占位")
    void emptyProjectReturnsEmpty() {
        var listing = listerFor(projectRoot.toString()).list("p1");
        assertTrue(listing.items().isEmpty(), "没有文件就该是空，而不是示例数据");
    }

    @Test
    @DisplayName("项目目录被删时如实返回空，不报一堆假文件")
    void missingDirectoryReturnsEmpty() {
        var listing = listerFor(projectRoot.resolve("已删除").toString()).list("p1");
        assertTrue(listing.items().isEmpty());
    }

    @Test
    @DisplayName("项目不存在时明确报 404")
    void unknownProjectFails() {
        ProjectRepository projects = mock(ProjectRepository.class);
        when(projects.findById("nope")).thenReturn(Optional.empty());
        var lister = new ProjectArtifactLister(projects);

        var error = assertThrows(ApiException.class, () -> lister.list("nope"));
        assertEquals(org.springframework.http.HttpStatus.NOT_FOUND, error.getStatus());
    }
}
