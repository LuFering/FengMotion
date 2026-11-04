package com.fengmotion.server.workflow.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fengmotion.server.common.ApiException;

import lombok.extern.slf4j.Slf4j;

/**
 * 调用 workflow-v5 的零依赖 Node 工具。
 *
 * <p><strong>为什么由后端调、而不是前端调</strong>：这些工具读写的是项目目录里的
 * 真实文件（{@code prompt.original.md}、{@code qa/passes/}），属于服务端职责。
 * 前端直连文件系统在打包应用里根本不成立。</p>
 *
 * <p><strong>为什么先只接 init-project / --check</strong>：这两个工具是
 * 「把用户原文落盘并建立目录」，不产生任何批准或渲染记录 ——
 * 接错也只是目录空着，不会伪造出一个「已完成」的假状态。
 * 执行层工具（preflight / validate-*）要等项目里真有产物再谈，
 * 否则它们只会如实报「11 项阻塞」，对用户没有意义。</p>
 *
 * <p><strong>安全边界</strong>：只执行固定路径下的脚本，参数由后端拼装，
 * 不接受前端传入的命令或任意脚本名。项目目录必须是后端算出来的绝对路径。</p>
 */
@Slf4j
@Component
public class WorkflowToolRunner {

    /** workflow-v5 目录；安装态由打包脚本放到 resources 下。 */
    @Value("${fengmotion.workflow.dir:}")
    private String workflowDir;

    /** node 可执行文件。 */
    @Value("${fengmotion.workflow.node:node}")
    private String nodeBinary;

    /** 单次工具超时：这些工具只读写小文件，10 秒足够。 */
    @Value("${fengmotion.workflow.timeout-seconds:20}")
    private long timeoutSeconds;

    /**
     * 解析 workflow-v5 根目录。
     *
     * <p>未配置时按开发态布局推断（backend/../desktop/workflow-v5）。
     * 找不到返回 null，由调用方明确报错 —— 不做「静默跳过」，
     * 那样界面会以为已经初始化成功。</p>
     *
     * @return 目录；不存在时 null
     */
    public Path resolveWorkflowRoot() {
        List<Path> candidates = new ArrayList<>();
        if (workflowDir != null && !workflowDir.isBlank()) {
            candidates.add(Path.of(workflowDir));
        }
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        // 开发态：后端在 backend/，workflow-v5 在 desktop/workflow-v5
        candidates.add(cwd.resolveSibling("desktop").resolve("workflow-v5"));
        candidates.add(cwd.resolve("desktop").resolve("workflow-v5"));
        candidates.add(cwd.resolve("workflow-v5"));

        for (Path candidate : candidates) {
            if (Files.isDirectory(candidate.resolve("prompt-first").resolve("tools"))) {
                return candidate.toAbsolutePath().normalize();
            }
        }
        return null;
    }

    /**
     * 初始化一个 Prompt-first 项目目录。
     *
     * <p>语义严格照工具本身：文件已存在时<strong>不覆盖</strong>
     * （{@code prompt.original.md} 必须是用户原文，被后来的摘要盖掉就毁了），
     * 且不生成任何方向/门禁/规格文件。</p>
     *
     * @param projectDir 项目目录（绝对路径）
     * @param filmId     影片 ID
     * @param prompt     用户原文；为 null 时用模板占位
     * @return 工具输出
     */
    public String initPromptFirstProject(Path projectDir, String filmId, String prompt) {
        Path root = requireWorkflowRoot();
        Path script = root.resolve("prompt-first").resolve("tools").resolve("init-project.mjs");

        List<String> command = new ArrayList<>();
        command.add(nodeBinary);
        command.add(script.toString());
        command.add(projectDir.toString());
        command.add("--film-id");
        command.add(filmId);

        /* 没有需求就明确拒绝，不要回落到模板。
           模板里的占位文字不是用户原文，写进去之后
           「initialized=true、原文 113 字」会是假的 —— 用户以为创作依据已经存好，
           实际存的是「（在这里粘贴用户原始高级提示词）」。
           workflow-v5 也明确规定 prompt.original.md 必须是用户原文。 */
        if (prompt == null || prompt.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "workflow_prompt_required",
                    "没有创作需求：prompt.original.md 要求写入用户原文，不能用模板占位。"
                            + "请先写下这次想做什么。");
        }

        Path promptFile = null;
        if (prompt != null && !prompt.isBlank()) {
            try {
                /* 原文经临时文件传入，而不是塞进命令行参数：
                   用户需求可能有换行、引号、几 KB 长，命令行会被 shell 规则咬。 */
                Files.createDirectories(projectDir);
                promptFile = Files.createTempFile("fm-prompt-", ".md");
                Files.writeString(promptFile, prompt);
                command.add("--prompt-file");
                command.add(promptFile.toString());
            } catch (IOException failure) {
                throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "workflow_tool_failed",
                        "无法写入原始需求文件：" + failure.getMessage());
            }
        }

        try {
            return run(command, root);
        } finally {
            if (promptFile != null) {
                try {
                    Files.deleteIfExists(promptFile);
                } catch (IOException ignored) {
                    // 临时文件删不掉不影响结果
                }
            }
        }
    }

    /**
     * 检查一个目录是否是合法的 Prompt-first 项目。
     *
     * @param projectDir 项目目录
     * @return 是否通过
     */
    public boolean checkPromptFirstProject(Path projectDir) {
        Path root = resolveWorkflowRoot();
        if (root == null) return false;
        Path script = root.resolve("prompt-first").resolve("tools").resolve("init-project.mjs");
        try {
            run(List.of(nodeBinary, script.toString(), "--check", projectDir.toString()), root);
            return true;
        } catch (ApiException notReady) {
            // 工具以非 0 退出表示「缺文件/内容过短」，是正常结论而不是故障
            return false;
        }
    }

    /**
     * 执行一个工具命令。
     *
     * @param command 命令与参数
     * @param workdir 工作目录
     * @return 标准输出
     */
    private String run(List<String> command, Path workdir) {
        Path stdoutFile = null;
        Path stderrFile = null;
        try {
            /* 与 Remotion 渲染一致：输出重定向到文件，避免管道写满阻塞子进程。
               这两个工具输出很短，但共用一套写法可少一类偶发挂起。 */
            stdoutFile = Files.createTempFile("fm-wf-stdout-", ".log");
            stderrFile = Files.createTempFile("fm-wf-stderr-", ".log");
            ProcessBuilder builder = new ProcessBuilder(command)
                    .directory(workdir.toFile())
                    .redirectOutput(stdoutFile.toFile())
                    .redirectError(stderrFile.toFile());

            Process process = builder.start();
            try {
                if (!process.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
                    throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "workflow_tool_timeout",
                            "工作流工具超时（超过 " + timeoutSeconds + " 秒）");
                }
            } finally {
                if (process.isAlive()) {
                    process.descendants().forEach(ProcessHandle::destroyForcibly);
                    process.destroyForcibly();
                }
            }

            String stdout = Files.readString(stdoutFile);
            String stderr = Files.readString(stderrFile);
            if (process.exitValue() != 0) {
                log.warn("workflow 工具失败：{} exit={} stderr={}",
                        command.get(1), process.exitValue(), stderr.trim());
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "workflow_tool_failed",
                        stderr.isBlank() ? stdout.trim() : stderr.trim());
            }
            log.info("workflow 工具完成：{}", command.get(1));
            return stdout;
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "workflow_tool_unavailable",
                    "无法执行工作流工具（需要 node）：" + failure.getMessage());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "workflow_tool_interrupted",
                    "工作流工具被中断");
        } finally {
            deleteQuietly(stdoutFile);
            deleteQuietly(stderrFile);
        }
    }

    /**
     * 解析 workflow 根目录，缺失时明确报错。
     *
     * @return 目录
     */
    private Path requireWorkflowRoot() {
        Path root = resolveWorkflowRoot();
        if (root == null) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "workflow_unavailable",
                    "找不到 workflow-v5 目录。请设置 fengmotion.workflow.dir 指向 desktop/workflow-v5");
        }
        return root;
    }

    /**
     * 静默删除临时文件。
     *
     * @param path 路径
     */
    private void deleteQuietly(Path path) {
        if (path == null) return;
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
            // 清理失败不影响结果
        }
    }
}
