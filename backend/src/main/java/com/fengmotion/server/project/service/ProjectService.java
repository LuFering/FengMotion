package com.fengmotion.server.project.service;

import java.io.IOException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import java.time.Instant;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.api.dto.CreateProjectRequest;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 处理项目创建：校验请求、确定项目目录、创建目录并保存项目记录。
 *
 * <p>
 * 请求未指定目录时，使用配置的工作区生成项目路径。
 * 幂等记录和数据库事务由调用此服务的 {@link ProjectCreationCoordinator} 协调。
 * </p>
 */
@Service
@RequiredArgsConstructor
@Slf4j

public class ProjectService {

    // final 依赖由 Lombok 生成的构造方法接收，Spring 负责注入。
    private final ProjectRepository projectRepository;
    private final ProjectDirectoryService projectDirectoryService;

    // 优先读取配置；没有配置时使用用户目录下的 FengMotion/projects。
    @Value("${fengmotion.workspace-root:${user.home}/FengMotion/projects}")
    private String workspaceRoot;

    /**
     * 创建项目目录和项目记录；保存记录失败时尝试清理刚创建的空目录。
     *
     * @param request 包含名称、可选片型、目标时长和项目路径的创建请求
     * @return 已保存的项目基础信息，包含生成的 ID 和创建时间
     * @throws ApiException 请求不合法、目录已存在或创建目录失败时抛出
     */
    public Project create(CreateProjectRequest request) {

        // 在操作文件系统之前校验请求，避免无效请求产生目录。
        if (request.name() == null || request.name().isBlank()) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "validation_error",
                    "项目名称不能为空");
        }

        if (request.name().length() > 200) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目名称过长");
        }
        if (request.targetDurationMs() != null && request.targetDurationMs() < 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "目标时长不能为负数");
        }

        if (request.rootPath() != null && request.rootPath().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目目录不能为空");
        }

        Path projectPath;
        try {

            if (request.rootPath() == null) {
                // 未传路径时，先确保默认工作区存在，再由名称生成目录名。
                if (workspaceRoot == null || workspaceRoot.isBlank()) {
                    throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "未配置工作区目录");
                }
                Path workspace = Path.of(workspaceRoot).toAbsolutePath().normalize(); // 将 workspaceRoot 转换成 Path对象
                projectDirectoryService.ensureWorkspace(workspace); // 确保工作区目录存在

                // 保留字母、数字、点、下划线和连字符；其他连续字符转换为连字符。
                String slug = request.name().strip().replaceAll("[^\\p{L}\\p{N}._-]+", "-")
                        .replaceAll("^[.\\-]+|[.\\-]+$", "");
                if (slug.isBlank()) {
                    throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目名称不能生成目录名");
                }
                projectPath = workspace.resolve(slug); // 这是在工作区目录下拼接的项目路径，这是前端不提供 rootPath时自行拼接
            } else {
                // 显式指定的项目路径要求是绝对路径，且不能是文件系统根目录。
                projectPath = Path.of(request.rootPath());
                if (!projectPath.isAbsolute()) {
                    throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目目录必须是绝对路径");
                }
                projectPath = projectPath.normalize(); // 规范化路径，在路径表示中去掉多余的 . 和可以抵消的 目录/..
                if (projectPath.getFileName() == null) {
                    throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "不能使用文件系统根目录");
                }
            }
        } catch (InvalidPathException ex) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目目录路径无效");
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "创建工作区目录失败");
        }

        /* 目标目录已存在时的处理分两种，不能一律报错：
         *
         * 1) 用户显式给了 rootPath：那是他指定的确切位置，占用就是冲突，
         *    必须报错 —— 悄悄换个目录存等于把项目放到别处。
         * 2) 没给 rootPath（前端「新建项目」就是这种）：目录名由名称推导，
         *    同名撞车是正常现象，应该自动避让。
         *
         * 原先两种情况都直接 409「项目目录已存在」。前端新建项目固定用
         * 「未命名项目」当名字，于是第一次之后每次新建都失败；
         * 更糟的是 init 失败会留下一个只有 AGENTS.md 的目录，
         * 之后的删除又清不掉（目录非空），用户从此再也建不出项目。 */
        boolean explicitRoot = request.rootPath() != null;
        try {
            /* 用新变量接返回值，不要自赋值：`x = f(x)` 里右边的 x 会被当成
               新声明的局部变量（null），导致后面 NPE。 */
            Path created = projectDirectoryService.createAvoidingCollision(projectPath, explicitRoot);
            projectPath = created;
        } catch (FileAlreadyExistsException ex) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "conflict",
                    "项目目录已存在");
        } catch (IOException ex) {
            throw new ApiException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "创建项目目录失败");
        }

        // ID 和创建时间由后端生成；保存规范化后的目录路径。
        Project project = new Project(
                UUID.randomUUID().toString(),
                request.name(),
                request.genomeId(),
                request.targetDurationMs(),
                projectPath.toString(),
                Instant.now());

        try {
            projectRepository.save(project); // 在DB载入数据
        } catch (RuntimeException ex) {
            // 只清理本次创建的空目录；保留原始异常和清理失败的信息。
            try {
                projectDirectoryService.deleteEmpty(projectPath);
            } catch (IOException cleanupFailure) {
                // 清理失败不覆盖保存失败；将其附在原异常上供排查。
                ex.addSuppressed(cleanupFailure);
            }
            throw ex;
        }

        // ID 到这一步才存在，回填到 AGENTS.md 的渲染命令里。
        // 失败不影响项目可用（Agent 只是不知道渲染接口），所以不让它抛出去。
        projectDirectoryService.rewriteAgentGuide(projectPath, project.id());

        /* 写身份标记：删除项目时靠它确认「这个目录确实属于这个项目」。
           失败不阻断创建，但那个项目以后删不掉（校验会拒绝），
           所以要留下痕迹，不能静默吞掉。 */
        try {
            projectDirectoryService.writeIdentity(projectPath, project.id(), project.name());
        } catch (IOException failed) {
            log.warn("写入项目身份标记失败，该项目将无法物理删除：{}", failed.getMessage());
        }

        return project;
    }
}
