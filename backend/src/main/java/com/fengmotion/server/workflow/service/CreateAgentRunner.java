package com.fengmotion.server.workflow.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.harness.client.DshLauncher;
import com.fengmotion.server.harness.client.DshProcess;
import com.fengmotion.server.harness.client.DshSdkSession;
import com.fengmotion.server.harness.config.HarnessProperties;
import com.fasterxml.jackson.databind.ObjectMapper;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 让创作 agent 在项目目录里改 Remotion 工程。
 *
 * <p><strong>它做什么、不做什么</strong>：agent 读 {@code prompt.original.md} 与
 * {@code corrections.md}，改 {@code src/} 里的源码，使画面符合要求。
 * <strong>渲染由后端做</strong>，不由 agent 调接口 —— 渲染是受控操作
 * （超时、进程清理、产物登记），交给模型自己调用会把这三件事都变成不可控。</p>
 *
 * <p><strong>工作目录就是项目目录</strong>：agent 通过 DSH 的 {@code cwd} 落在项目里，
 * 这样它看到的就是真实文件（含自动加载的 {@code AGENTS.md} 项目指引），
 * 不需要我们把文件内容再抄进 prompt —— 抄一份就等于有两份事实。</p>
 *
 * <p><strong>这一轮没有进程/网络隔离</strong>：agent 写的代码以当前用户权限运行。
 * 所以这里只做「让它改文件」，不主动要求它执行任意命令；
 * 真正的隔离手段到位之前，不要把「禁止联网」当成本轮已实现的事实。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CreateAgentRunner {

    private final DshLauncher launcher;
    private final HarnessProperties properties;
    private final ObjectMapper json;

    /** agent 单次创作超时：改一个工程比生成一段文字久得多。 */
    @Value("${fengmotion.workflow.agent-timeout-seconds:600}")
    private long timeoutSeconds;

    /**
     * 让 agent 按需求与纠正修改项目工程。
     *
     * @param projectRoot 项目根目录（agent 的工作目录）
     * @param intent      这一轮要做什么；null 表示按现有需求与纠正自主推进
     * @return 结果摘要
     */
    public AgentOutcome run(Path projectRoot, String intent) {
        if (!Files.isDirectory(projectRoot)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目目录不存在");
        }
        if (!Files.isRegularFile(projectRoot.resolve("prompt.original.md"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "workflow_not_initialized",
                    "项目还没有 prompt.original.md：请先写下原始创作需求。");
        }

        String instruction = buildInstruction(intent);
        Instant startedAt = Instant.now();
        String reply = ask(projectRoot, instruction);
        long elapsedMs = Duration.between(startedAt, Instant.now()).toMillis();

        /* 判断 agent 到底动没动工程：没改动就如实说，不要假装完成。
           用户点了一次「让 agent 改」，结果什么都没变，必须能看出来。 */
        boolean hasEntry = Files.isRegularFile(projectRoot.resolve("src").resolve("index.tsx"));
        boolean hasConfig = Files.isRegularFile(projectRoot.resolve(ProjectFilmConfig.FILE_NAME));

        log.info("创作 agent 完成：project={} 耗时={}ms entry={} config={}",
                projectRoot.getFileName(), elapsedMs, hasEntry, hasConfig);
        return new AgentOutcome(reply, elapsedMs, hasEntry, hasConfig);
    }

    /**
     * 组装给 agent 的指令。
     *
     * <p>不重复 {@code AGENTS.md} 里的创作方法 —— 那份文件会被自动加载。
     * 这里只说这一轮要做什么，以及交付判据（入口在哪、配置怎么写）。</p>
     *
     * @param intent 这一轮的意图
     * @return 指令
     */
    private String buildInstruction(String intent) {
        String task = (intent == null || intent.isBlank())
                ? "按 prompt.original.md 与 corrections.md 推进这部片子"
                : intent;

        return """
                这一轮要做的事：%s

                请在这个项目目录里工作：
                1. 先读 prompt.original.md（用户原文，逐字，不要改写）和 corrections.md（后续纠正，较新的优先）。
                2. 修改 src/ 里的 Remotion 源码，让画面符合要求。可以新增或调整组件。
                3. 确保 src/index.tsx 里 registerRoot 注册了一个 Composition，
                   并在 film.config.json 写清 entry 与 compositionId（两个名字必须与实际一致）。
                4. 不要自己调用渲染接口，也不要伪造视频文件 —— 后端会负责渲染。

                交付判据（后端会据此检查）：
                - src/index.tsx 存在且能通过打包
                - film.config.json 的 entry 指向真实文件，compositionId 与代码里的 id 一致

                做完后用一两句话说明你改了什么、画面变成什么样。不要贴大段代码。
                """.formatted(task);
    }

    /**
     * 起一次 dsh 会话跑这一轮创作。
     *
     * @param workdir     工作目录
     * @param instruction 指令
     * @return agent 的最后一段回复
     */
    private String ask(Path workdir, String instruction) {
        DshProcess process = null;
        try {
            process = launcher.startSdk();
            DshSdkSession driver = new DshSdkSession(
                    process, json, properties.getProvider(), properties.getModel());
            // stderr 必须排空，否则管道写满会阻塞子进程
            process.drainStderr(50, frame -> { });

            String sessionId = "fm-create-" + java.util.UUID.randomUUID();
            /* cwd 指向项目目录：agent 看到的是真实文件，
               也会自动加载该项目里的 AGENTS.md 指引。 */
            driver.initialize(workdir.toString(), Duration.ofSeconds(20));

            DshSdkSession.Outcome outcome = driver.prompt(
                    sessionId, instruction, QuietListener.INSTANCE,
                    Duration.ofSeconds(timeoutSeconds));

            if (outcome.failed()) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "create_agent_failed",
                        "创作 agent 执行失败：" + (outcome.failure() == null ? "未知原因" : outcome.failure()));
            }
            return outcome.text() == null ? "" : outcome.text();
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "create_agent_failed",
                    "无法启动创作 agent：" + failure.getMessage());
        } finally {
            if (process != null) {
                process.close();
            }
        }
    }

    /**
     * 创作 agent 的结果。
     *
     * @param reply        agent 的说明
     * @param elapsedMs    耗时
     * @param hasEntry     是否产出 src/index.tsx
     * @param hasConfig    是否产出 film.config.json
     */
    public record AgentOutcome(String reply, long elapsedMs, boolean hasEntry, boolean hasConfig) {
    }

    /** 什么都不做的监听器：这一轮不需要流式回调。 */
    private enum QuietListener implements DshSdkSession.Listener {
        INSTANCE;

        @Override public void onTurnStarted(int turn) { }
        @Override public void onStepStarted(int turn, int step) { }
        @Override public void onToolCall(String callId, String name, String arguments) { }
        @Override public void onToolResult(String callId, String text, boolean isError) { }
        @Override public void onTextDelta(String text) { }
        @Override public void onThinkingDelta(String text) { }
        @Override public void onAssistantMessage(String text, String reasoning) { }
        @Override public void onTurnEnded(boolean failed, String reason) { }
        @Override public void onIdle() { }
    }
}
