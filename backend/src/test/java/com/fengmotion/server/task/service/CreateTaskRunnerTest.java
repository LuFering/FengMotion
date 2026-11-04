package com.fengmotion.server.task.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Instant;
import java.util.Optional;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.task.domain.Task;

/**
 * 创建执行器的边界：它在什么情况下不该开工。
 *
 * <p>不启动真实模型与渲染 —— 那要几十秒。真实创建链路由端到端验证覆盖；
 * 这里只钉住「拒绝条件」，因为误判的代价是覆盖用户已有内容。</p>
 */
@DisplayName("创建执行器的拒绝条件")
class CreateTaskRunnerTest {

    private final ObjectMapper json = new ObjectMapper();

    /**
     * 造一个已有场景的项目仓储。
     *
     * @param version 已有版本号
     * @return 场景仓储
     */
    private ProjectSceneRepository scenesWith(long version) {
        return new ProjectSceneRepository() {
            @Override public Optional<ProjectScene> find(String projectId) {
                return Optional.of(new ProjectScene(projectId, version,
                        json.createObjectNode().putArray("scenes"), "t-old", Instant.now()));
            }
            @Override public Optional<Long> updateIfVersionMatches(
                    String projectId, long expectedVersion, com.fasterxml.jackson.databind.JsonNode film, String taskId) {
                throw new AssertionError("创建被拒绝时不应写场景");
            }
            @Override public Optional<Long> commitWithSnapshot(
                    String projectId, long expectedVersion, com.fasterxml.jackson.databind.JsonNode film,
                    String taskId, String prompt, String editSummary, String artifactPath,
                    String source, Long fromVersion) {
                throw new AssertionError("创建被拒绝时不应提交版本");
            }
            @Override public java.util.List<com.fengmotion.server.project.domain.ProjectSceneVersion>
                    listVersions(String projectId) {
                return java.util.List.of();
            }
            @Override public Optional<com.fengmotion.server.project.domain.ProjectSceneVersion>
                    findVersion(String projectId, long version) {
                return Optional.empty();
            }
        };
    }

    /**
     * 空项目仓储。
     *
     * @param rootPath 项目目录
     * @return 项目仓储
     */
    private ProjectRepository projectAt(String rootPath) {
        return new ProjectRepository() {
            @Override public void save(Project project) { }
            @Override public Optional<Project> findById(String id) {
                return Optional.of(new Project(id, "测试", "explainer", null, rootPath, Instant.now()));
            }
        };
    }


    /**
     * 一个什么都不做的进度通道。
     *
     * @return 进度通道
     */
    private static TaskService.Progress quiet() {
        return new TaskService.Progress() {
            @Override public void report(int percent, String message) { }
            @Override public boolean isCancelled() { return false; }
        };
    }

    /**
     * 造一个创建任务。
     *
     * @param projectId 项目
     * @param request   请求体
     * @return 任务
     */
    private Task task(String projectId, com.fasterxml.jackson.databind.JsonNode request) {
        Instant now = Instant.now();
        return new Task("t-create", projectId, "create", "queued", "需求", request,
                0, "", null, null, now, now, null, null, null);
    }

    @Test
    @DisplayName("项目已有场景时拒绝创建，避免覆盖用户内容")
    void refusesWhenSceneExists() {
        Long v = 3L;
        var runner = new CreateTaskRunner(null, null, projectAt("/tmp/x"), scenesWith(v), null);
        var request = json.createObjectNode().put("kind", "create").put("prompt", "再来一条");

        ApiException e = assertThrows(ApiException.class,
                () -> runner.run(task("p1", request), quiet()));

        assertEquals("scene_already_exists", e.getCode());
        // 报错要说清现状与出路，而不是只说「不行」
        assertEquals(true, e.getMessage().contains("版本 3"), e.getMessage());
        assertEquals(true, e.getMessage().contains("回退"), e.getMessage());
    }

    @Test
    @DisplayName("项目没有目录时拒绝，不去猜一个位置写文件")
    void refusesWithoutProjectDirectory() {
        var runner = new CreateTaskRunner(null, null, projectAt(null), scenesWith(0L), null);
        var request = json.createObjectNode().put("kind", "create").put("prompt", "x");

        ApiException e = assertThrows(ApiException.class,
                () -> runner.run(task("p1", request), quiet()));

        assertEquals("validation_error", e.getCode());
    }

    @Test
    @DisplayName("项目不存在时 404")
    void refusesMissingProject() {
        ProjectRepository empty = new ProjectRepository() {
            @Override public void save(Project project) { }
            @Override public Optional<Project> findById(String id) { return Optional.empty(); }
        };
        var runner = new CreateTaskRunner(null, null, empty, scenesWith(0L), null);
        var request = json.createObjectNode().put("kind", "create").put("prompt", "x");

        ApiException e = assertThrows(ApiException.class,
                () -> runner.run(task("nope", request), quiet()));

        assertEquals("not_found", e.getCode());
    }
}
