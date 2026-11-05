package com.fengmotion.server.workflow.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.stream.Stream;
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
import com.fengmotion.server.retrieval.RetrievalResult;
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

    private final com.fengmotion.server.retrieval.SemanticIndex semanticIndex;
    private final DshLauncher launcher;
    private final HarnessProperties properties;
    private final ObjectMapper json;

    /**
     * 还没有任何源码时的指纹。
     *
     * <p>新建工程在 agent 动手前根本没有 {@code src/}。这时指纹是一个确定的「空」值，
     * 而不是「读取失败」—— 否则 agent 从零建出整个工程也会被判成「没有改动」。</p>
     */
    static final String EMPTY_FINGERPRINT = "files=0;sha256=empty";

    /** 后端自动撰写的检索记录文件名（项目目录下）。 */
    static final String RETRIEVAL_LOG = "retrieval-log.md";

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
    public AgentOutcome run(Path projectRoot, String intent, ResourceContextBuilder.ResourceContext resources) {
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
        String beforeHash = sourceFingerprint(projectRoot);
        if (beforeHash.startsWith("error:")) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_unreadable", "无法读取当前工程，创作尚未开始");
        }

        String instruction = buildInstruction(intent, resources, retrieveCandidates(projectRoot, intent));
        Instant startedAt = Instant.now();
        String reply = ask(projectRoot, instruction);
        long elapsedMs = Duration.between(startedAt, Instant.now()).toMillis();

        /* 判断 agent 到底动没动工程：没改动就如实说，不要假装完成。
           用户点了一次「让 agent 改」，结果什么都没变，必须能看出来。

           注意：不能只看 src/index.tsx 和 film.config.json 是否存在 ——
           对已有工程，这两个文件本来就在，agent 什么都不做也会「存在」，
           于是旧工程被重渲一遍，用户却以为改好了。所以比内容指纹。 */
        boolean hasEntry = Files.isRegularFile(projectRoot.resolve("src").resolve("index.tsx"));
        boolean hasConfig = Files.isRegularFile(projectRoot.resolve(ProjectFilmConfig.FILE_NAME));
        String afterHash = sourceFingerprint(projectRoot);
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

    /**
     * 工程源码的内容指纹。
     *
     * <p>比较 src、public、工程配置与依赖声明，排除渲染产物和依赖缓存。
     * 替换同名素材也会改变结果，因此 public 中的文件参与比较。
     * 用内容而不是修改时间：重写相同内容不会被误判为画面已变。</p>
     *
     * @param projectRoot 项目根
     * @return 形如 "files=N;sha256=..." 的指纹；读不到时返回 "error:x"
     */
    // 包可见：单测要直接对比同一工程改动前后的指纹
    static String sourceFingerprint(Path projectRoot) {
        try {
            List<Path> files = new java.util.ArrayList<>();
            // 替换被引用的图片/音频也会改变画面，不能只比较 src。
            for (String directory : List.of("src", "public")) {
                Path folder = projectRoot.resolve(directory);
                if (!Files.isDirectory(folder)) continue;
                try (Stream<Path> walk = Files.walk(folder)) {
                    files.addAll(walk.filter(Files::isRegularFile).toList());
                }
            }
            for (String name : List.of(ProjectFilmConfig.FILE_NAME, "package.json")) {
                Path file = projectRoot.resolve(name);
                if (Files.isRegularFile(file)) files.add(file);
            }
            if (files.isEmpty()) return EMPTY_FINGERPRINT;
            files.sort(java.util.Comparator.naturalOrder());
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[65536];
            for (Path file : files) {
                digest.update(projectRoot.relativize(file).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                digest.update((byte) 0);
                try (var input = Files.newInputStream(file)) {
                    int count;
                    while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
                }
                digest.update((byte) 0);
            }
            return "files=" + files.size() + ";sha256=" + HexFormat.of().formatHex(digest.digest());
        } catch (Exception ex) {
            log.warn("计算源码指纹失败：{}", projectRoot, ex);
            return "error:" + ex.getClass().getSimpleName();
        }
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
    private String buildInstruction(String intent, ResourceContextBuilder.ResourceContext resources,
                                    String candidates) {
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

        return """
                这一轮要做的事：%s
                %s
                %s

                请在这个项目目录里工作：
                1. 先读 prompt.original.md（用户原文，逐字，不要改写）和 corrections.md（后续纠正，较新的优先）。
                2. 修改 src/ 里的 Remotion 源码，让画面符合要求。可以新增或调整组件。
                3. 确保 src/index.tsx 里 registerRoot 注册了一个 Composition，
                   并在 film.config.json 写清 entry 与 compositionId（两个名字必须与实际一致）。
                4. 不要自己调用渲染接口，也不要伪造视频文件 —— 后端会负责渲染。
                5. 在 decisions.md 里补一段「本轮参考」：
                   - 检索状态是「检索成功」「索引未就绪」还是「向量服务失败」（以 retrieval-log.md 为准）；
                   - 用了哪条候选就写它的 ID，并说明用在了画面哪个位置；
                   - 一条都没用就写「未采用」，并说明为什么（不相关 / 不适合本片）。
                   没有参考任何条目时也要写清这一点，不要略过。

                交付判据（后端会据此检查）：
                - src/index.tsx 存在且能通过打包
                - film.config.json 的 entry 指向真实文件，compositionId 与代码里的 id 一致

                做完后用一两句话说明你改了什么、画面变成什么样。不要贴大段代码。
                """.formatted(task, resourceBlock, candidates);
    }

    /**
     * 按这一轮的任务描述，从三库与 capabilities 里召回可用的技法、镜头卡。
     *
     * <p><strong>为什么在这一层做</strong>：用户说「那种镜头快速推近、背景被拉开的眩晕感」时，
     * 库里并没有这些字，只有「多莉变焦」和它的做法。字面检索命中 0 条，
     * 语义检索能把它们召回 —— 没有这一步，agent 只能自己从零编视觉。</p>
     *
     * <p><strong>同时落盘</strong>：检索结果既进这一轮指令，也写进项目目录的
     * {@value #RETRIEVAL_LOG}。只进指令的话，会话一结束就查不到「系统到底检过什么」，
     * 事后既无法验证 agent 有没有参考，也无法复盘召回质量。</p>
     *
     * @param projectRoot 项目根
     * @param intent      这一轮的意图
     * @return 给 agent 看的候选清单；检索不可用或没有候选时为空串
     */
    private String retrieveCandidates(Path projectRoot, String intent) {
        String query = (intent == null || intent.isBlank()) ? readPrompt(projectRoot) : intent;
        if (query == null || query.isBlank()) return "";

        List<String> kinds = List.of("technique", "capability");
        RetrievalResult result;
        try {
            result = semanticIndex.search(query, kinds, 6);
        } catch (RuntimeException failed) {
            log.warn("语义检索异常，本轮不提供候选：{}", failed.getMessage());
            result = RetrievalResult.empty(RetrievalResult.Status.SERVICE_FAILED, query, kinds);
        }

        writeRetrievalLog(projectRoot, result);
        log.info("创作检索：status={} query={} 命中 {} 条 {}", result.status(),
                abbreviate(query, 60), result.hits().size(),
                result.hits().stream().map(h -> h.kind() + ":" + h.id()).toList());

        /* 三种「没有候选」必须对 agent 说不同的话，否则它会以为查过了。 */
        switch (result.status()) {
            case SERVICE_FAILED -> {
                return """
                        （本轮语义检索不可用：向量服务调用失败。**这不等于「库里没有相关内容」**。
                        你可以自行设计画面，但不要声称查过库、也不要编造库里没有的技法名；
                        如需确认某条技法是否存在，直接去技法库目录查。）
                        """;
            }
            case INDEX_NOT_READY -> {
                return """
                        （本轮语义检索不可用：索引尚未建立。**这不等于「库里没有相关内容」**。
                        可以自行设计画面，但不要声称查过库、也不要编造库里没有的技法名。）
                        """;
            }
            case SUCCESS_NO_MATCH -> {
                return """
                        （本轮已检索技法库与能力库，确实没有相近条目。可以自行设计，
                        但不要凭空引用库里不存在的技法名。）
                        """;
            }
            default -> {
                // SUCCESS_WITH_HITS，走下面的候选清单
            }
        }

        StringBuilder sb = new StringBuilder("""
                下面是从技法库与能力库按这一轮需求召回的相关条目（不是用户指定，是可选参考）：
                用得上就照着做或借鉴，用不上就别硬套；不要编造库里没有的技法。
                完整检索记录见项目目录的 %s。
                """.formatted(RETRIEVAL_LOG));
        for (var hit : result.hits()) {
            sb.append("- [").append(hit.kind()).append("] ").append(hit.id())
              .append("（相似度 ").append(String.format("%.2f", hit.score())).append("）：")
              .append(abbreviate(hit.text(), 160)).append('\n');
        }
        return sb.toString();
    }

    /**
     * 把本轮检索结果追加到项目目录的 {@value #RETRIEVAL_LOG}。
     *
     * <p>这里记的是<strong>系统做了什么</strong>：查询、范围、状态、命中、以及从哪读完整内容。
     * agent 采用了什么、为什么不用，留给 agent 自己在 {@code decisions.md} 里写 ——
     * 后端代写「采用决定」就等于替 agent 宣称它没做过的事。</p>
     *
     * <p>写日志失败不影响创作：这是证据，不是交付物。</p>
     *
     * @param projectRoot 项目根
     * @param result      检索结果
     */
    private void writeRetrievalLog(Path projectRoot, RetrievalResult result) {
        StringBuilder sb = new StringBuilder();
        sb.append("\n## ").append(Instant.now()).append('\n')
          .append("- 状态：`").append(result.status()).append("`（")
          .append(switch (result.status()) {
              case SUCCESS_WITH_HITS -> "检索成功，有候选";
              case SUCCESS_NO_MATCH -> "检索成功，无相近条目";
              case INDEX_NOT_READY -> "索引未就绪，本轮没有真正比对过内容";
              case SERVICE_FAILED -> "向量服务调用失败，本轮没有真正比对过内容";
          })
          .append("）\n")
          .append("- 查询：").append(oneLine(result.query())).append('\n')
          .append("- 范围：").append(result.kinds() == null || result.kinds().isEmpty()
                  ? "全部" : String.join("、", result.kinds())).append('\n');
        if (result.hits().isEmpty()) {
            sb.append("- 命中：无\n");
        } else {
            sb.append("- 命中：\n");
            for (var hit : result.hits()) {
                sb.append("  - `").append(hit.kind()).append(':').append(hit.id()).append("` 段")
                  .append(hit.chunk()).append(" 相似度 ").append(String.format("%.3f", hit.score()))
                  .append("：").append(oneLine(abbreviate(hit.text(), 200))).append('\n');
            }
        }
        try {
            Path log = projectRoot.resolve(RETRIEVAL_LOG);
            boolean fresh = !Files.isRegularFile(log);
            Files.writeString(log,
                    (fresh ? "# 检索记录\n\n由后端在每次创作前自动追加：本文件只记录系统检索事实。\n"
                            + "agent 是否采用、为何不用，见 decisions.md。\n" : "")
                            + sb,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException failed) {
            log.warn("写入检索记录失败（不影响创作）：{}", failed.getMessage());
        }
    }

    /**
     * 压成一行，避免多行文本破坏 Markdown 列表结构。
     *
     * @param text 原文
     * @return 单行文本
     */
    private static String oneLine(String text) {
        return text == null ? "" : text.replaceAll("\\s+", " ").trim();
    }

    /**
     * 读项目原文，作为没有明确意图时的检索依据。
     *
     * @param projectRoot 项目根
     * @return 原文；读不到时为空串
     */
    private String readPrompt(Path projectRoot) {
        try {
            Path file = projectRoot.resolve("prompt.original.md");
            return Files.isRegularFile(file) ? Files.readString(file) : "";
        } catch (IOException unreadable) {
            return "";
        }
    }

    /**
     * 截断过长文本。
     *
     * @param text 原文
     * @param max  上限
     * @return 截断结果
     */
    private String abbreviate(String text, int max) {
        if (text == null) return "";
        String flat = text.replace('\n', ' ').strip();
        return flat.length() <= max ? flat : flat.substring(0, max) + "…";
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
