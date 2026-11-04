package com.fengmotion.server.workflow.service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 项目与 workflow-v5 的衔接。
 *
 * <p><strong>为什么需要这一层</strong>：workflow-v5 的创作上下文是
 * <em>项目目录里的文件</em>（{@code prompt.original.md} 等），而应用里用户只看到
 * 「项目」。两者此前没有任何连接：应用从不让用户写下原始需求，
 * 项目目录里也就没有 workflow-v5 认的创作上下文，那套流程自然跑不起来。</p>
 *
 * <p><strong>这一层只做「建立上下文」，不做创作</strong>：把用户原文逐字落盘、
 * 建好 {@code qa/passes/}，然后如实报告目录状态。它不会替你写 lookdev、
 * 不会伪造方向或批准 —— 那些由创作阶段按 {@code prompts/creator.md} 产生。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WorkflowProjectService {

    private final ProjectRepository projects;
    private final WorkflowToolRunner tools;

    /** 一个 Prompt-first 项目应当存在的文件。 */
    private static final List<String> PROMPT_FIRST_FILES = List.of(
            "prompt.original.md",
            "corrections.md",
            "decisions.md",
            "lookdev-brief.md",
            "quality-bar.md",
            "film-plan.md",
            "project.json");

    /**
     * 为项目建立 Prompt-first 创作上下文。
     *
     * <p>重复调用是安全的：工具本身不覆盖已存在的文件，
     * 所以第二次调用不会把用户改过的原文冲掉。</p>
     *
     * @param projectId 项目 ID
     * @param prompt    用户原始需求；为空时只建模板骨架
     * @return 目录状态
     */
    public WorkflowProjectState init(String projectId, String prompt) {
        Project project = requireProject(projectId);
        Path root = requireRoot(project);

        tools.initPromptFirstProject(root, projectId, prompt);
        return state(projectId);
    }

    /**
     * 读取项目的 workflow 上下文状态。
     *
     * <p>「目录里有什么」是客观事实，如实返回 —— 前端据此显示进度，
     * 而不是自己猜「大概初始化过了」。</p>
     *
     * @param projectId 项目 ID
     * @return 状态
     */
    public WorkflowProjectState state(String projectId) {
        Project project = requireProject(projectId);
        Path root = Path.of(project.rootPath()).toAbsolutePath().normalize();

        boolean initialized = Files.isRegularFile(root.resolve("prompt.original.md"));
        List<String> present = PROMPT_FIRST_FILES.stream()
                .filter(name -> Files.isRegularFile(root.resolve(name)))
                .toList();

        /* 原文长度用于判断「是不是只建了模板还没写内容」。
           模板本身有内容，所以这里只作为参考值展示，不据此判定完成。 */
        long promptLength = 0;
        Path original = root.resolve("prompt.original.md");
        if (Files.isRegularFile(original)) {
            try {
                promptLength = Files.readString(original).trim().length();
            } catch (Exception unreadable) {
                promptLength = -1;
            }
        }

        // qa/passes 下有几次真实渲染，是「创作真的推进了」的客观证据
        int passes = 0;
        Path passesDir = root.resolve("qa").resolve("passes");
        if (Files.isDirectory(passesDir)) {
            try (Stream<Path> children = Files.list(passesDir)) {
                passes = (int) children.filter(Files::isDirectory).count();
            } catch (Exception unreadable) {
                passes = -1;
            }
        }

        boolean toolAvailable = tools.resolveWorkflowRoot() != null;
        return new WorkflowProjectState(
                projectId,
                root.toString(),
                initialized,
                toolAvailable,
                present,
                promptLength,
                passes);
    }

    /**
     * 确认项目存在。
     *
     * @param projectId 项目 ID
     * @return 项目
     */
    private Project requireProject(String projectId) {
        return projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
    }

    /**
     * 确认项目有目录。
     *
     * @param project 项目
     * @return 目录
     */
    private Path requireRoot(Project project) {
        String rootPath = project.rootPath();
        if (rootPath == null || rootPath.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "项目还没有目录，无法建立创作上下文");
        }
        return Path.of(rootPath).toAbsolutePath().normalize();
    }

    /**
     * 项目 workflow 上下文状态。
     *
     * @param projectId    项目 ID
     * @param directory    项目目录
     * @param initialized  是否已有 prompt.original.md（这是 workflow-v5 的入口条件）
     * @param toolAvailable workflow-v5 工具目录是否可找到
     * @param files        已存在的 Prompt-first 文件
     * @param promptLength 原文长度；读不到时为 -1
     * @param passes       已完成的渲染轮次数；读不到时为 -1
     */
    public record WorkflowProjectState(String projectId, String directory, boolean initialized,
                                       boolean toolAvailable, List<String> files,
                                       long promptLength, int passes) {
    }
}
