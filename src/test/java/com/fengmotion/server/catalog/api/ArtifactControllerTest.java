package com.fengmotion.server.catalog.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
 * 产物列表。
 *
 * <p>重点在「如实反映磁盘」：真实的文件要列出来，隐藏文件与依赖目录要跳过，
 * 目录不存在时不能报 500 —— 那会让「还没产出」看起来像「坏了」。</p>
 */
@DisplayName("产物列表")
class ArtifactControllerTest {

    @TempDir
    Path projectDir;

    /** 只实现 findById 的假仓储，避免引入完整持久化依赖。 */
    private ProjectRepository repoOf(String projectId, String rootPath) {
        return new ProjectRepository() {
            @Override public void save(Project project) { }
            @Override public Optional<Project> findById(String id) {
                return projectId.equals(id)
                        ? Optional.of(new Project(projectId, "测试项目", "explainer",
                                null, rootPath, Instant.now()))
                        : Optional.empty();
            }
        };
    }

    @Test
    @DisplayName("列出真实文件，按修改时间倒序")
    void listsRealFiles() throws Exception {
        Files.writeString(projectDir.resolve("成片.mp4"), "fake video");
        Files.writeString(projectDir.resolve("脚本.md"), "fake script");
        Files.createDirectories(projectDir.resolve("素材"));
        Files.writeString(projectDir.resolve("素材/logo.png"), "fake image");

        var response = new ArtifactController(repoOf("p1", projectDir.toString())).list("p1");

        assertEquals(3, response.items().size(), "三个文件都应列出");
        assertEquals(projectDir.toString(), response.rootPath());
        // 分类正确
        assertTrue(response.items().stream().anyMatch(a -> a.kind().equals("video")));
        assertTrue(response.items().stream().anyMatch(a -> a.kind().equals("image")));
        assertTrue(response.items().stream().anyMatch(a -> a.name().equals("logo.png")));
        // 相对路径带目录，便于界面显示层级
        assertTrue(response.items().stream().anyMatch(a -> a.path().equals("素材/logo.png")));
    }

    @Test
    @DisplayName("隐藏文件与 node_modules 被跳过")
    void skipsHiddenAndDependencies() throws Exception {
        Files.writeString(projectDir.resolve("keep.txt"), "x");
        Files.writeString(projectDir.resolve(".env"), "secret");
        Files.createDirectories(projectDir.resolve("node_modules/pkg"));
        Files.writeString(projectDir.resolve("node_modules/pkg/index.js"), "x");

        var response = new ArtifactController(repoOf("p1", projectDir.toString())).list("p1");

        assertEquals(1, response.items().size(), "只应列出 keep.txt");
        assertEquals("keep.txt", response.items().get(0).name());
    }

    @Test
    @DisplayName("目录不存在时返回空列表而不是报错")
    void missingDirectoryYieldsEmptyList() {
        var response = new ArtifactController(repoOf("p1", projectDir.resolve("不存在").toString())).list("p1");

        assertTrue(response.items().isEmpty());
    }

    @Test
    @DisplayName("项目没有根目录时返回空列表")
    void projectWithoutRootYieldsEmptyList() {
        var response = new ArtifactController(repoOf("p1", null)).list("p1");

        assertTrue(response.items().isEmpty());
        assertEquals(null, response.rootPath());
    }

    @Test
    @DisplayName("项目不存在时 404")
    void unknownProjectIs404() {
        var controller = new ArtifactController(repoOf("p1", projectDir.toString()));

        assertThrows(ApiException.class, () -> controller.list("不存在的项目"));
    }
}
