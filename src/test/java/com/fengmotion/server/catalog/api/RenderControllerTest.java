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

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.catalog.service.RemotionRenderer;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

/**
 * 渲染端点的输入校验与产物路径。
 *
 * <p>不测真实渲染 —— 那要起 Chromium、跑几十秒，不适合放进单测。
 * 真实渲染由端到端验证覆盖；这里只钉住「什么请求会被拒绝」和
 * 「产物落在哪」这两条容易出错的边界。</p>
 */
@DisplayName("渲染端点")
class RenderControllerTest {

    @TempDir
    Path root;

    private final ObjectMapper json = new ObjectMapper();

    private ProjectRepository repoOf(String projectId, String rootPath) {
        return new ProjectRepository() {
            @Override public void save(Project project) { }
            @Override public Optional<Project> findById(String id) {
                return projectId.equals(id)
                        ? Optional.of(new Project(projectId, "测试项目", "explainer", null, rootPath, Instant.now()))
                        : Optional.empty();
            }
        };
    }

    /** 记录是否被调用，用于确认非法请求根本不会走到渲染。 */
    private static final class SpyRenderer extends RemotionRenderer {
        boolean called = false;
        SpyRenderer() { super(new ObjectMapper()); }
        @Override
        public RenderResult render(com.fasterxml.jackson.databind.JsonNode film, Path outputFile) {
            called = true;
            try {
                Files.createDirectories(outputFile.getParent());
                Files.writeString(outputFile, "fake");
            } catch (java.io.IOException e) {
                throw new RuntimeException(e);
            }
            return new RenderResult(outputFile.toString(), 30, 640, 360, 30);
        }
    }

    @Test
    @DisplayName("scenes 为空被拒绝，且不会触发渲染")
    void rejectsEmptyScenes() throws Exception {
        SpyRenderer renderer = new SpyRenderer();
        var controller = new RenderController(repoOf("p1", root.toString()), renderer, json);

        var film = json.readTree("""
                {"width":640,"height":360,"fps":30,"scenes":[]}
                """);

        assertThrows(ApiException.class, () -> controller.render("p1", film));
        assertEquals(false, renderer.called, "非法请求不该走到渲染");
    }

    @Test
    @DisplayName("缺少 scenes 字段被拒绝")
    void rejectsMissingScenes() throws Exception {
        SpyRenderer renderer = new SpyRenderer();
        var controller = new RenderController(repoOf("p1", root.toString()), renderer, json);

        var film = json.readTree("""
                {"width":640,"height":360,"fps":30}
                """);

        assertThrows(ApiException.class, () -> controller.render("p1", film));
    }

    @Test
    @DisplayName("项目没有目录时拒绝渲染")
    void rejectsProjectWithoutRoot() throws Exception {
        SpyRenderer renderer = new SpyRenderer();
        var controller = new RenderController(repoOf("p1", null), renderer, json);

        var film = json.readTree("""
                {"width":640,"height":360,"fps":30,"scenes":[{"id":"s","durationSeconds":1}]}
                """);

        assertThrows(ApiException.class, () -> controller.render("p1", film));
        assertEquals(false, renderer.called);
    }

    @Test
    @DisplayName("产物落在项目的 renders/ 子目录，与用户素材分开")
    void writesIntoRendersSubdirectory() throws Exception {
        SpyRenderer renderer = new SpyRenderer();
        var controller = new RenderController(repoOf("p1", root.toString()), renderer, json);

        var film = json.readTree("""
                {"width":640,"height":360,"fps":30,"scenes":[{"id":"s","durationSeconds":1}]}
                """);

        var response = controller.render("p1", film);

        String path = response.artifact().path("path").asText();
        assertTrue(path.startsWith("renders/"), "产物应在 renders/ 下，实际：" + path);
        assertTrue(path.endsWith(".mp4"));
        assertTrue(Files.isDirectory(root.resolve("renders")));
        assertEquals(640, response.artifact().path("width").asInt());
    }
}
