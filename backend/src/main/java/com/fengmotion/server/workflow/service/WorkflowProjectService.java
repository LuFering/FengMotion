package com.fengmotion.server.workflow.service;

import java.io.IOException;
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
    public WorkflowProjectService.InitOutcome init(String projectId, String prompt) {
        Project project = requireProject(projectId);
        Path root = requireRoot(project);

        if (prompt == null || prompt.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "workflow_prompt_required",
                    "没有创作需求：prompt.original.md 要求写入用户原文，不能用模板占位。"
                            + "请先写下这次想做什么。");
        }

        Path original = root.resolve("prompt.original.md");
        if (Files.isRegularFile(original)) {
            /* 原文已存在：这才是真正要小心的情况。
               工具的语义是不覆盖原文（对的 —— 原文是创作依据），
               但它也不会把新需求记下来，于是用户第二次说的话会静默消失，
               界面还照样显示「上下文已就绪」。
               按 workflow-v5 的约定，后续要求属于「纠正」，应追加到 corrections.md。 */
            String existing = readIfPossible(original);
            if (existing != null && existing.trim().equals(prompt.trim())) {
                // 同一条需求重复提交（比如界面重复点击）：什么都不用做，也不能重复记一条纠正
                return new InitOutcome(state(projectId), InitResult.UNCHANGED, null);
            }
            appendCorrection(root, prompt);
            return new InitOutcome(state(projectId), InitResult.RECORDED_AS_CORRECTION,
                    "已存在原始需求，这次的要求按「纠正」追加到 corrections.md（原需求未被覆盖）。");
        }

        tools.initPromptFirstProject(root, projectId, prompt);
        return new InitOutcome(state(projectId), InitResult.CREATED, null);
    }

    /**
     * 把后续需求作为纠正追加到 corrections.md。
     *
     * <p>格式照 workflow-v5 的模板：时间 + 用户原话。这里只记原话，
     * 「影响范围」「是否已落实到 decisions」由创作阶段判断后补，不代填。</p>
     *
     * @param root   项目目录
     * @param prompt 用户新要求
     */
    private void appendCorrection(Path root, String prompt) {
        Path file = root.resolve("corrections.md");
        String entry = "\n## " + java.time.OffsetDateTime.now()
                .withNano(0) + "\n\n- 用户原话：" + prompt.trim() + "\n";
        try {
            if (!Files.isRegularFile(file)) {
                Files.writeString(file, "# 用户纠正（追加）\n" + entry);
                return;
            }
            Files.writeString(file, entry,
                    java.nio.file.StandardOpenOption.APPEND);
        } catch (IOException failure) {
            /* 记不下来就不能假装记下了 —— 用户会以为自己说的被采纳。 */
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "workflow_correction_failed",
                    "无法写入 corrections.md：" + failure.getMessage());
        }
    }

    /**
     * 读文件，失败返回 null。
     *
     * @param path 路径
     * @return 内容或 null
     */
    private String readIfPossible(Path path) {
        try {
            return Files.readString(path);
        } catch (IOException unreadable) {
            return null;
        }
    }

    /** 初始化结果的性质。 */
    public enum InitResult {
        /** 首次建立上下文 */
        CREATED,
        /** 需求与已有原文相同，无变化 */
        UNCHANGED,
        /** 原文已存在，本次要求被记为纠正 */
        RECORDED_AS_CORRECTION
    }

    /**
     * 初始化结果。
     *
     * @param state 建立后的状态
     * @param result 这次到底发生了什么
     * @param note  需要告诉用户的说明；无则为 null
     */
    public record InitOutcome(WorkflowProjectState state, InitResult result, String note) {
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

        /* 渲染轮次不能靠「目录存在」判断：空目录、建了一半的目录、
           失败后留下的目录都会让计数虚高，而用户看到「已渲染 3 轮」
           会以为有 3 个能看的片子。
           这里按目录里是否真有视频文件来判，并区分三种状态。 */
        int rendered = 0;
        int failed = 0;
        int inProgress = 0;
        Path passesDir = root.resolve("qa").resolve("passes");
        if (Files.isDirectory(passesDir)) {
            try (Stream<Path> children = Files.list(passesDir)) {
                for (Path pass : children.filter(Files::isDirectory).toList()) {
                    switch (classifyPass(pass)) {
                        case RENDERED -> rendered++;
                        case FAILED -> failed++;
                        case IN_PROGRESS -> inProgress++;
                    }
                }
            } catch (Exception unreadable) {
                // 读不到就报 -1，别把「读不到」显示成「0 轮」
                rendered = -1;
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
                rendered,
                failed,
                inProgress);
    }

    /**
     * 判断一轮 pass 的真实状态。
     *
     * <p>判据是目录里有没有视频文件（这是「渲出来了」的硬证据），
     * 其次看有没有失败标记。两者都没有就是还没产出 ——
     * 不能因为目录存在就算一轮。</p>
     *
     * @param passDir pass 目录
     * @return 状态
     */
    private PassStatus classifyPass(Path passDir) {
        try (Stream<Path> files = Files.walk(passDir, 2)) {
            boolean hasVideo = files.anyMatch(p -> {
                String name = p.getFileName().toString().toLowerCase();
                return Files.isRegularFile(p)
                        && (name.endsWith(".mp4") || name.endsWith(".webm") || name.endsWith(".mov"));
            });
            if (hasVideo) return PassStatus.RENDERED;
        } catch (Exception unreadable) {
            return PassStatus.IN_PROGRESS;
        }
        // 没有视频：有失败记录就算失败，否则当作还没做完
        boolean hasFailure = Files.isRegularFile(passDir.resolve("failure.md"))
                || Files.isRegularFile(passDir.resolve("error.md"));
        return hasFailure ? PassStatus.FAILED : PassStatus.IN_PROGRESS;
    }

    /** 一轮渲染的状态。 */
    private enum PassStatus {
        /** 有视频文件 */
        RENDERED,
        /** 有失败记录但没有视频 */
        FAILED,
        /** 目录在，但还没产物 */
        IN_PROGRESS
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
     * @param renderedPasses   真正有视频产物的轮次数；读不到时为 -1
     * @param failedPasses     留下失败记录、没有视频的轮次数
     * @param inProgressPasses 目录存在但还没有产物的轮次数
     */
    public record WorkflowProjectState(String projectId, String directory, boolean initialized,
                                       boolean toolAvailable, List<String> files,
                                       long promptLength, int renderedPasses,
                                       int failedPasses, int inProgressPasses) {
    }
}
