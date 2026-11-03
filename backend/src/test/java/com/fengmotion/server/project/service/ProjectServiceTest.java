package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.doThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import java.io.IOException;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;


import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.api.dto.CreateProjectRequest;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;


/** 通过模拟仓储验证项目创建与名称校验的业务逻辑。 */
class ProjectServiceTest {
    // 模拟对象记录调用，不访问真实数据库。
    private final ProjectRepository projectRepository = mock(ProjectRepository.class);
    private final ProjectDirectoryService projectDirectoryService=mock(ProjectDirectoryService.class);
    private final ProjectService projectService =
        new ProjectService(projectRepository, projectDirectoryService);

    @org.junit.jupiter.api.io.TempDir
    Path workspace;

    /** 未指定目录时使用配置的工作区和项目名称。 */
    @Test
    void usesDefaultWorkspace() {
        org.springframework.test.util.ReflectionTestUtils.setField(projectService, "workspaceRoot", workspace.toString());
        Project project = projectService.create(new CreateProjectRequest("新 项目", null, null, null));
        assertEquals(workspace.resolve("新-项目").toString(), project.rootPath());
    }

    /** 路径为空字符串时拒绝请求。 */
    @Test
    void rejectsBlankPath() {
        ApiException error = assertThrows(ApiException.class,
                () -> projectService.create(new CreateProjectRequest("测试项目", null, null, " ")));
        assertEquals(org.springframework.http.HttpStatus.BAD_REQUEST, error.getStatus());
        verifyNoInteractions(projectRepository, projectDirectoryService);
    }

    /** 合法请求生成项目，并将同一份数据保存和返回。 */
    @Test
    void createsAndSaveProject(){
        CreateProjectRequest request = new CreateProjectRequest(
            "测试项目",
                "genome-001",
                60000L,
                "/projects/test"
        );

        Project result = projectService.create(request);

        // 捕获传给 save 的项目，检查生成字段及请求字段。
        ArgumentCaptor<Project> captor = ArgumentCaptor.forClass(Project.class);
        verify(projectRepository).save(captor.capture());

        Project saved = captor.getValue();
        assertNotNull(saved.id());
        assertNotNull(saved.id());
        assertEquals(request.name(), saved.name());
        assertEquals(request.genomeId(), saved.genomeId());
        assertEquals(request.targetDurationMs(), saved.targetDurationMs());
        assertEquals(request.rootPath(), saved.rootPath());
        assertNotNull(saved.createdAt());
        assertEquals(saved, result);
    }
    /** 空白名称应被拒绝，且不能触发保存。 */
    @Test
    void rejectsBlankNameWithoutSaving(){
        CreateProjectRequest request = new CreateProjectRequest(
            "  ",
            null,
            null,
            null
        );

        assertThrows(ApiException.class,()->projectService.create(request));
        verifyNoInteractions(projectRepository);
    }

    /** 保存失败时清理刚创建的目录，并保留原始异常。 */
    @Test
    void deletesCreatedDirectoryWhenSaveFails() throws IOException {
        Path projectPath = Path.of("/projects/test");
        CreateProjectRequest request = new CreateProjectRequest(
                "测试项目", null, null, projectPath.toString());
        RuntimeException saveFailure = new RuntimeException("数据库保存失败");

        doThrow(saveFailure).when(projectRepository).save(any(Project.class));

        RuntimeException thrown = assertThrows(
                RuntimeException.class, () -> projectService.create(request));

        assertSame(saveFailure, thrown);
        verify(projectDirectoryService).deleteEmpty(projectPath);
    }

    /** 清理失败时保留保存异常，并附带清理异常供排查。 */
    @Test
    void preservesCleanupFailureWhenSaveFails() throws IOException {
        Path path = Path.of("/projects/test");
        RuntimeException saveFailure = new RuntimeException("数据库保存失败");
        IOException cleanupFailure = new IOException("目录清理失败");
        doThrow(saveFailure).when(projectRepository).save(any(Project.class));
        doThrow(cleanupFailure).when(projectDirectoryService).deleteEmpty(path);

        RuntimeException thrown = assertThrows(RuntimeException.class,
                () -> projectService.create(new CreateProjectRequest("测试项目", null, null, path.toString())));

        assertSame(saveFailure, thrown);
        assertEquals(1, thrown.getSuppressed().length);
        assertSame(cleanupFailure, thrown.getSuppressed()[0]);
    }

    /** 目录已存在时返回冲突，且不写入数据库。 */
    @Test
    void rejectsExistingDirectoryWithoutSaving() throws IOException {
        Path path = Path.of("/projects/existing");
        doThrow(new java.nio.file.FileAlreadyExistsException(path.toString()))
                .when(projectDirectoryService).create(path);

        ApiException error = assertThrows(ApiException.class,
                () -> projectService.create(new CreateProjectRequest("测试项目", null, null, path.toString())));

        assertEquals(org.springframework.http.HttpStatus.CONFLICT, error.getStatus());
        verifyNoInteractions(projectRepository);
    }

    /** 测试创建目录再保存项目的流程*/
    @Test 
    void createsDirectoryBeforeSavingProject() throws IOException{
        CreateProjectRequest request = new CreateProjectRequest(
            "测试项目",
            null,
            null,
            "/projects/test"
        );

        projectService.create(request);

        InOrder order = inOrder(projectDirectoryService, projectRepository);
        order.verify(projectDirectoryService).create(Path.of("/projects/test"));
        order.verify(projectRepository).save(any(Project.class));
    }
}
