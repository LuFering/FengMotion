package com.fengmotion.server.creation.service;

import com.fengmotion.server.creation.store.CreationProgressStore;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.service.ProjectSourceFingerprint;

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

    private final CreationReferenceService references;
    private final DshLauncher launcher;
    private final com.fengmotion.server.harness.client.NativeHarnesses nativeHarnesses;
    private final com.fengmotion.server.harness.service.HarnessService harnesses;
    private final ThreadLocal<com.fengmotion.server.harness.client.NativeHarnesses.Selection> selection = new ThreadLocal<>();
    private final HarnessProperties properties;
    private final ObjectMapper json;
    private final CreationProgressStore progressStore;

    /**
     * 还没有任何源码时的指纹。
     *
     * <p>新建工程在 agent 动手前根本没有 {@code src/}。这时指纹是一个确定的「空」值，
     * 而不是「读取失败」—— 否则 agent 从零建出整个工程也会被判成「没有改动」。</p>
     */

    /**
     * agent 单次创作超时。
     *
     * <p>实测 agent 会自己跑 tsc / remotion bundle 自查，单轮 2–15 分钟不等，
     * 600 秒会把「正常但在自查」的回合误判成超时。默认给到 20 分钟，
     * 与前端 create 请求的 25 分钟预算留出余量。</p>
     */
    @Value("${fengmotion.workflow.agent-timeout-seconds:}")
    private long timeoutSeconds;

    /**
     * 让 agent 按需求与纠正修改项目工程。
     *
     * @param projectRoot 项目根目录（agent 的工作目录）
     * @param intent      这一轮要做什么；null 表示按现有需求与纠正自主推进
     * @return 结果摘要
     */
    public void validateSelection(com.fengmotion.server.harness.client.NativeHarnesses.Selection selected) {
        if (selected == null) return;
        try {
            if (selected.nativeEngine()) nativeHarnesses.validate(selected);
            else {
                if (selected.harness() != null && !selected.harness().equals("deepseek") && !selected.harness().equals("dsh-sdk")) throw new IllegalArgumentException("未知引擎");
                if (!harnesses.isAvailable()) throw new IllegalArgumentException("DeepSeek Harness 不可用");
                if (selected.model() != null && harnesses.listModels("dsh-sdk").stream().noneMatch(m -> m.id().equals(selected.model()))) throw new IllegalArgumentException("模型不在 DeepSeek Harness 目录中");
            }
        } catch (IllegalArgumentException failure) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", failure.getMessage());
        }
    }

    public AgentOutcome run(Path projectRoot, String intent, ResourceContextBuilder.ResourceContext resources) {
        return run(projectRoot, intent, resources, null);
    }

    public AgentOutcome run(Path projectRoot, String intent, ResourceContextBuilder.ResourceContext resources, String previewImage) {
        return run(projectRoot, intent, resources, previewImage, ignored -> { });
    }

    public AgentOutcome run(Path root, String intent, ResourceContextBuilder.ResourceContext resources, String image,
                            String projectId, String sessionId, String requestId,
                            com.fengmotion.server.harness.client.NativeHarnesses.Selection selected) {
        selection.set(selected);
        try { return run(root, intent, resources, image, projectId, sessionId, requestId); }
        finally { selection.remove(); }
    }

    public AgentOutcome run(Path projectRoot, String intent, ResourceContextBuilder.ResourceContext resources, String previewImage,
                            String projectId, String sessionId, String requestId) {
        progressStore.begin(projectId, sessionId, requestId);
        try {
            return run(projectRoot, intent, resources, previewImage, text -> progressStore.append(projectId, requestId, text));
        } finally {
            progressStore.finish(projectId, requestId);
        }
    }

    AgentOutcome runShotFilm(Path root, String intent, ResourceContextBuilder.ResourceContext resources, String image,
                             String projectId, String sessionId, String requestId,
                             com.fengmotion.server.harness.client.NativeHarnesses.Selection selected) {
        selection.set(selected);
        progressStore.begin(projectId, sessionId, requestId);
        try {
            return run(root, intent, resources, image, text -> progressStore.append(projectId, requestId, text), true);
        } finally {
            progressStore.finish(projectId, requestId);
            selection.remove();
        }
    }

    public AgentOutcome run(Path projectRoot, String intent, ResourceContextBuilder.ResourceContext resources, String previewImage,
                            java.util.function.Consumer<String> onProgress) {
        return run(projectRoot, intent, resources, previewImage, onProgress, false);
    }

    private AgentOutcome run(Path projectRoot, String intent, ResourceContextBuilder.ResourceContext resources, String previewImage,
                             java.util.function.Consumer<String> onProgress, boolean shotTimeline) {
        var images = previewImages(previewImage);
        if (!Files.isDirectory(projectRoot)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目目录不存在");
        }
        if (!Files.isRegularFile(projectRoot.resolve("prompt.original.md"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "workflow_not_initialized",
                    "项目还没有 prompt.original.md：请先写下原始创作需求。");
        }

        /* 资源清单同时写进项目目录：agent 在会话里能读到，
           下一个人接手（或换个会话再来）也还能看到用户当初指定了什么。
           只塞进这一轮的 prompt，等于这些信息随会话消失。 */
        writeResourceBrief(projectRoot, resources);

        /* 动手之前先留一份源码指纹，用来判断这一轮到底有没有改到画面。 */
        String beforeHash = ProjectSourceFingerprint.compute(projectRoot);
        if (beforeHash.startsWith("error:")) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_unreadable", "无法读取当前工程，创作尚未开始");
        }

        String instruction = buildInstruction(intent, resources, references.resolveCandidates(projectRoot, intent),
                Files.isRegularFile(projectRoot.resolve("skill-guide.md")),
                com.fengmotion.server.harness.client.DshNarration.inGuide(projectRoot), shotTimeline);
        Instant startedAt = Instant.now();
        String reply = ask(projectRoot, instruction, images, onProgress);
        long elapsedMs = Duration.between(startedAt, Instant.now()).toMillis();

        /* 判断 agent 到底动没动工程：没改动就如实说，不要假装完成。
           用户点了一次「让 agent 改」，结果什么都没变，必须能看出来。

           注意：不能只看 src/index.tsx 和 film.config.json 是否存在 ——
           对已有工程，这两个文件本来就在，agent 什么都不做也会「存在」，
           于是旧工程被重渲一遍，用户却以为改好了。所以比内容指纹。 */
        boolean hasEntry = new ProjectFilmConfig(json).tryRead(projectRoot).isPresent();
        boolean hasConfig = Files.isRegularFile(projectRoot.resolve(ProjectFilmConfig.FILE_NAME));
        String afterHash = ProjectSourceFingerprint.compute(projectRoot);
        if (afterHash.startsWith("error:")) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_unreadable", "无法读取 agent 修改后的工程，未渲染，请检查项目文件");
        }
        boolean changed = didChange(beforeHash, afterHash);

        log.info("创作 agent 完成：project={} 耗时={}ms entry={} config={} changed={}",
                projectRoot.getFileName(), elapsedMs, hasEntry, hasConfig, changed);
        return new AgentOutcome(reply, elapsedMs, hasEntry, hasConfig, changed, beforeHash, afterHash);
    }

    /**
     * 这一轮是否真的改到了工程。
     *
     * <p>判据是内容指纹变化，而不是「文件存在」。对已有工程，
     * {@code src/index.tsx} 与 {@code film.config.json} 本来就存在，
     * 用存在性判断会把「agent 只提问」记成「已完成」。</p>
     *
     * <p>指纹读取失败（null / error）时返回 false：宁可让用户多点一次，
     * 也不能把没改的东西报成改好了。</p>
     *
     * @param before 动手前指纹
     * @param after  动手后指纹
     * @return 内容真的变了为 true
     */
    static boolean didChange(String before, String after) {
        if (before == null || after == null) return false;
        if (before.startsWith("error:") || after.startsWith("error:")) return false;
        return !before.equals(after);
    }

    /** 项目选用了从 skill 生成的视频类型时追加的一步。优先级规则在指引文件开头也写了一遍，这里再重申。 */
    static final String SKILL_GUIDE_STEP = """
               再读 skill-guide.md：这是本项目选用的视频类型的方法指引，按它的方法做。
               与 prompt.original.md、corrections.md 冲突时，以原文和纠正为准。
               指引里提到的脚本一律不要执行；需要检查时用本项目自己的渲染与检查。
               .fengmotion/skill-sources/ 里的组件源码只读，要用时复制进 src/ 再按本项目的视觉系统改写。
            """;

    /**
     * 组装给 agent 的指令。
     *
     * <p>不重复 {@code AGENTS.md} 里的创作方法 —— 那份文件会被自动加载。
     * 这里只说这一轮要做什么，以及交付判据（入口在哪、配置怎么写）。</p>
     *
     * @param intent        这一轮的意图
     * @param hasSkillGuide 项目里有 skill-guide.md（选用了从 skill 生成的视频类型）
     * @param narrationInGuide 项目 AGENTS.md 已写有交流方式；否则把同一份规则拼进指令兜底
     * @return 指令
     */
    static String buildInstruction(String intent, ResourceContextBuilder.ResourceContext resources,
                                   String candidates, boolean hasSkillGuide, boolean narrationInGuide) {
        return buildInstruction(intent, resources, candidates, hasSkillGuide, narrationInGuide, false);
    }

    static String buildInstruction(String intent, ResourceContextBuilder.ResourceContext resources,
                                   String candidates, boolean hasSkillGuide, boolean narrationInGuide, boolean shotTimeline) {
        String task = (intent == null || intent.isBlank())
                ? "按 prompt.original.md 与 corrections.md 推进这部片子"
                : intent;

        String resourceBlock = resources.available()
                ? """
                用户这次明确指定了下列资源，用途已经写明，**不要自行更改用途**：
                %s

                注意：
                - 「仅参考」的资源不要出现在成片画面里。
                - 参考片只借鉴手法与节奏，不要复用它的画面。
                - 用法不清楚时先问，不要猜。
                """.formatted(resources.description())
                : "";

        String delivery = shotTimeline ? """
                2. 这次采用镜头装配试点。这个交付契约优先于 AGENTS.md 或技能中自建入口的旧要求。
                   每个镜头组件放在 src/shots/<sourceId>.tsx，命名导出 Shot，不注册 Composition。
                   镜头内部可自由用 Remotion/React 做图表、动效和排版；用镜头本地帧驱动动画。
                   可共享只读配色、字体与纯数据；不要在镜头内放音频、发网络请求或修改全局样式。
                3. 写 film.config.json，例如：
                   {"format":"shot-timeline-v1","width":1280,"height":720,"fps":30,"shots":[{"id":"intro","sourceId":"chart","label":"咖啡因对比","frames":120},{"id":"end","sourceId":"outro","label":"片尾","frames":90}],"voiceover":"voiceover.wav"}
                   镜头按数组顺序硬切，后端计算起点和总时长并生成入口。id 是唯一实例名，sourceId 对应组件文件，均用小写字母开头及小写数字、下划线或短横线。
                   如有可用旁白，将它独立放在 public/voiceover.wav（也支持 mp3、m4a），让画面节奏对齐旁白；无旁白需求时省略 voiceover。不要伪造配音，如缺少必要素材则先问。
                   不要写 entry、compositionId 或自建总装入口。
                """ : """
                2. 修改 src/ 里的 Remotion 源码，让画面符合要求。可以新增或调整组件。
                3. 确保 src/index.tsx 里 registerRoot 注册了一个 Composition，
                   并在 film.config.json 写清 entry 与 compositionId（两个名字必须与实际一致）。
                """;
        String acceptance = shotTimeline ? "合法的镜头清单、每个命名导出的 Shot 能通过装配与渲染。"
                : "src/index.tsx 存在且能通过打包；film.config.json 的 entry 指向真实文件，compositionId 与代码里的 id 一致。";

        return """
                这一轮要做的事：%s
                %s
                %s

                %s

                请在这个项目目录里工作：
                1. 先读 prompt.original.md（用户原文，逐字，不要改写）和 corrections.md（后续纠正，较新的优先）。
                   lookdev-brief.md、film-plan.md 如果已不是模板原样，里面是用户或上一轮定下的视觉构想与导演处理，
                   按已确认的方向对待；要偏离时在 decisions.md 写明原因。
                %s%s4. 不要自己调用渲染接口，也不要伪造视频文件 —— 后端会负责渲染。
                5. 在 decisions.md 里补一段「本轮参考」：
                   - 检索状态是「检索成功」「索引未就绪」还是「向量服务失败」（以 retrieval-log.md 为准）；
                   - 用了哪条候选就写它的 ID，并说明用在了画面哪个位置；
                   - 一条都没用就写「未采用」，并说明为什么（不相关 / 不适合本片）。
                   没有参考任何条目时也要写清这一点，不要略过。

                交付判据（后端会据此检查）：%s

                做完后用一两句话说明你改了什么、画面变成什么样。不要贴大段代码。
                """.formatted(task, resourceBlock, candidates,
                        narrationInGuide ? "" : "交流方式：\n" + com.fengmotion.server.harness.client.DshNarration.WORK_BLOCKS,
                        hasSkillGuide ? SKILL_GUIDE_STEP : "", delivery, acceptance);
    }

    /**
     * 把资源清单写进项目目录。
     *
     * @param projectRoot 项目根
     * @param resources   资源上下文
     */
    private void writeResourceBrief(Path projectRoot, ResourceContextBuilder.ResourceContext resources) {
        Path file = projectRoot.resolve("resources-in-use.md");
        try {
            if (!resources.available()) {
                /* 没有资源时删掉旧清单：留着上一轮的清单会误导 ——
                   agent 会以为用户这轮还指定了那些资源。 */
                Files.deleteIfExists(file);
                return;
            }
            Files.writeString(file, """
                    # 本次使用的资源

                    用户在这一轮创作里明确指定的资源与用途。改动工程时必须遵守这些用途。

                    """ + resources.description() + "\n");
        } catch (IOException failed) {
            log.warn("写入资源清单失败：{}", failed.getMessage());
        }
    }

    /**
     * 起一次 dsh 会话跑这一轮创作。
     *
     * @param workdir     工作目录
     * @param instruction 指令
     * @return agent 的最后一段回复
     */
    static java.util.List<DshSdkSession.InlineImage> previewImages(String image) {
        if (image == null) return java.util.List.of();
        boolean png = image.startsWith("data:image/png;base64,");
        if (image.length() > 5_000_000 || (!png && !image.startsWith("data:image/jpeg;base64,"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "画面图片格式无效或超过大小限制");
        }
        String data = image.substring((png ? "data:image/png;base64," : "data:image/jpeg;base64,").length());
        try {
            byte[] bytes = java.util.Base64.getDecoder().decode(data);
            boolean valid = png ? bytes.length >= 8 && java.util.Arrays.equals(java.util.Arrays.copyOf(bytes,8),new byte[]{(byte)137,80,78,71,13,10,26,10})
                    : bytes.length >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 && (bytes[2] & 255) == 255;
            if (!valid)
                throw new IllegalArgumentException();
        } catch (IllegalArgumentException failure) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "画面图片数据无效");
        }
        return java.util.List.of(new DshSdkSession.InlineImage(data, png ? "image/png" : "image/jpeg"));
    }

    private String ask(Path workdir, String instruction, java.util.List<DshSdkSession.InlineImage> images,
                       java.util.function.Consumer<String> onProgress) {
        var selected = selection.get();
        if (selected != null && selected.nativeEngine()) {
            try {
                return nativeHarnesses.run(selected, workdir, instruction, images, new ProgressListener(onProgress),
                        Duration.ofSeconds(timeoutSeconds), ignored -> { });
            } catch (IOException | IllegalArgumentException failure) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "create_agent_failed", "创作引擎执行失败：" + failure.getMessage());
            }
        }
        DshProcess process = null;
        try {
            process = launcher.startSdk();
            DshSdkSession driver = new DshSdkSession(
                    process, json, properties.getProvider(), selected == null || selected.model() == null ? properties.getModel() : selected.model(), selected == null ? null : com.fengmotion.server.harness.client.NativeHarnesses.effort(selected, harnesses.listModels("dsh-sdk")));
            // stderr 必须排空，否则管道写满会阻塞子进程
            process.drainStderr(200, driver::acceptStreamFrame);

            String sessionId = "fm-create-" + java.util.UUID.randomUUID();
            /* cwd 指向项目目录：agent 看到的是真实文件，
               也会自动加载该项目里的 AGENTS.md 指引。 */
            driver.initialize(workdir.toString(), Duration.ofSeconds(20));

            DshSdkSession.Outcome outcome = driver.prompt(
                    sessionId, instruction, images, new ProgressListener(onProgress),
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
     * @param hasEntry     是否具有有效工程入口或镜头装配配置
     * @param hasConfig    是否产出 film.config.json
     */
    /**
     * 一轮创作的结果。
     *
     * @param reply      agent 的说明
     * @param elapsedMs  耗时
     * @param hasEntry   入口文件是否存在
     * @param hasConfig  工程配置是否存在
     * @param changed    源码内容是否真的变了（false = agent 只说了话没动手）
     * @param beforeHash 动手前的源码指纹
     * @param afterHash  动手后的源码指纹
     */
    public record AgentOutcome(String reply, long elapsedMs, boolean hasEntry, boolean hasConfig,
                               boolean changed, String beforeHash, String afterHash) {
    }

    /** 只传递 Agent 的公开文字；内部推理与工具参数不作为进度。 */
    static final class ProgressListener implements DshSdkSession.Listener {
        private final java.util.function.Consumer<String> progress;
        private boolean streamed;
        ProgressListener(java.util.function.Consumer<String> progress) { this.progress = progress; }

        @Override public void onTurnStarted(int turn) { }
        @Override public void onStepStarted(int turn, int step) { }
        @Override public void onToolCall(String callId, String name, String arguments) { if (streamed) progress.accept("\n"); }
        @Override public void onToolResult(String callId, String text, boolean isError) { }
        @Override public void onTextDelta(String text) { streamed = true; progress.accept(text); }
        @Override public void onThinkingDelta(String text) { }
        @Override public void onAssistantMessage(String text, String reasoning) {
            if (streamed) progress.accept("\n");
            else if (text != null && !text.isBlank()) progress.accept(text + "\n");
            streamed = false;
        }
        @Override public void onTurnEnded(boolean failed, String reason) { }
        @Override public void onIdle() { }
    }
}
