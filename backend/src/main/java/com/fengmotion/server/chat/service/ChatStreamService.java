package com.fengmotion.server.chat.service;

import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.chat.domain.ChatMessage;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatMessageRepository;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.harness.client.DshLauncher;
import com.fengmotion.server.harness.client.DshProcess;
import com.fengmotion.server.harness.client.DshSdkSession;
import com.fengmotion.server.harness.config.HarnessProperties;
import com.fengmotion.server.harness.service.HarnessService;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

/**
 * 把 DSH 的一次对话投影成 SSE 帧。
 *
 * <p><strong>关于 token 级增量</strong>：DSH 的 SDK 通道本身只给「整段文本」，
 * 但随包插件 {@code fengmotion-stream} 订阅了 DSH 内部的 {@code agent/assistant-stream}
 * 并发到 stderr，因此本轮能推送真正的 {@code delta} 帧（详见
 * {@code docs/harness集成与接口清单.md} §11）。{@code delta} 是尽力而为的增强：
 * 插件不可用或帧丢失时，{@code completed} 仍会带全文，前端不应依赖 delta 拼接出最终结果。</p>
 *
 * <p><strong>进程模型</strong>：每轮起一个 {@code dsh} 子进程，用完即关；会话靠
 * {@code session/resume} 冷续接。这与 open-design 在 DSH 上的做法一致（其
 * {@code dsh-profile} 适配层同样每轮 {@code execute} 后 {@code stdin.end()}），
 * 不引入常驻进程池——理由见 {@code docs/harness集成与接口清单.md} §12。</p>
 *
 * <p>助手回复只有在整轮成功结束后才落库：失败时不写半截内容，也不写「假装成功」的消息。
 * 这对应契约 {@code agent.md} §4「不得用半截文本冒充完成」。</p>
 */
@Service
@RequiredArgsConstructor
public class ChatStreamService {

    /** 一轮耗时埋点的输出通道（观测用，不参与业务判断）。 */
    private static final org.slf4j.Logger LOG =
            org.slf4j.LoggerFactory.getLogger(ChatStreamService.class);

    /**
     * 工具参数下发的长度上限。
     *
     * <p>工具参数可能是整段文件内容或 base64 图片，原样下发会把单帧撑到几百 KB；
     * 4000 字符足够界面显示「在做什么」，超出部分从 {@code callId} 侧仍可追溯。</p>
     */
    private static final int MAX_ARGUMENT_CHARS = 4000;

    private final HarnessService harness;
    private final com.fengmotion.server.upload.service.UploadService uploads;
    private final com.fengmotion.server.project.store.ProjectRepository projects;
    private final HarnessProperties properties;
    private final DshLauncher launcher;
    private final ChatSessionRepository sessions;
    private final ChatMessageRepository messages;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;

    /**
     * 当前请求的 SSE 缓冲刷新动作。
     *
     * <p>用 ThreadLocal 而不是实例字段：同一个 Service 会被多个请求并发使用，
     * 实例字段会让 A 请求的 flush 作用到 B 请求的响应上。每个请求在
     * {@link #stream} 入口设置、退出时清除。</p>
     */
    private final ThreadLocal<Runnable> currentFlush = new ThreadLocal<>();

    /**
     * 引擎当前是否可用。
     *
     * <p>Controller 用它做前置判断：引擎不可用是比「没有可发送的内容」更根本的阻塞，
     * 应当先返回 {@code 503 agent_unavailable}，而不是让用户先看到「请先发一条消息」。
     *
     * @return 可用时返回 true
     */
    public boolean isAvailable() {
        return harness.isAvailable();
    }

    /**
     * 执行一次对话并把事件写成 SSE。
     *
     * <p>方法阻塞直到整轮结束；调用方（Controller）负责 HTTP 响应生命周期。</p>
     *
     * @param sessionId 本项目会话 ID
     * @param writer    SSE 输出；调用方需保证线程安全
     * @param userText  本轮用户消息正文（已由发送接口落库，这里只用于驱动引擎）
     * @throws ApiException 引擎不可用或会话不存在时抛出（此时尚未写出任何帧）
     */
    public void stream(String sessionId, PrintWriter writer, String userText, Runnable flush) {
        stream(sessionId, writer, userText, null, flush);
    }

    /**
     * 执行一轮对话并把事件写成 SSE（可携带附件）。
     *
     * @param sessionId   会话 ID
     * @param writer      SSE 输出
     * @param userText    本轮用户消息
     * @param attachments 该条消息带的附件元信息；可为 null
     * @param flush       每帧写出后的刷新动作（Tomcat 需要 flushBuffer 才能真正推送）
     */
    public void stream(String sessionId, PrintWriter writer, String userText,
                       com.fasterxml.jackson.databind.JsonNode attachments, Runnable flush) {
        currentFlush.set(flush);
        try {
            doStream(sessionId, writer, userText, attachments);
        } finally {
            currentFlush.remove();
        }
    }

    /**
     * 实际执行对话并把事件写成 SSE。
     *
     * @param sessionId 会话 ID
     * @param writer    SSE 输出
     * @param userText  本轮用户消息
     */
    /**
     * 解析本次对话的工作目录：优先项目根目录，退化到配置的全局目录。
     *
     * <p>为什么以项目为准：AI 通过 {@code write}/{@code bash} 产出的文件写在当前工作目录。
     * 若固定用全局目录，多个项目的产物会混在一起，且无法归属到任何一个项目，
     * 界面上看不到「这个项目产出了什么」。</p>
     *
     * @param session 当前会话
     * @return DSH 子进程的工作目录（绝对路径）
     */
    private String workingDirectoryFor(ChatSession session) {
        String projectId = session.projectId();
        if (projectId != null && !projectId.isBlank()) {
            var project = projects.findById(projectId);
            if (project.isPresent()) {
                String root = project.get().rootPath();
                if (root != null && !root.isBlank()) {
                    return root;
                }
            }
        }
        // 项目没有根目录（或会话没有归属）时退回全局目录：宁可产物落在公共位置，
        // 也不要因为缺路径让整轮对话失败。
        return properties.workingDirectory().toString();
    }

    /**
     * 把消息里的附件元信息转成可发送的内联图片。
     *
     * <p>只挑出 DSH 协议认可的四种栅格格式；其他附件（视频、PDF、文本）本轮跳过 ——
     * 协议没有对应的内联块类型，硬塞会让整条消息被准入阶段拒绝，
     * 连文本都发不出去。跳过是可用性优先，不是静默丢数据：附件仍在服务端，
     * 将来协议支持了可以直接接上。</p>
     *
     * @param attachments 附件元信息数组；可为 null
     * @return 可发送的图片；没有时为空列表
     */
    private List<DshSdkSession.InlineImage> inlineImages(com.fasterxml.jackson.databind.JsonNode attachments) {
        if (attachments == null || !attachments.isArray()) {
            return List.of();
        }
        List<DshSdkSession.InlineImage> images = new java.util.ArrayList<>();
        for (com.fasterxml.jackson.databind.JsonNode item : attachments) {
            // 前端的附件形状以 fileId 指向上传结果；缺字段就跳过，不做猜测
            String fileId = item.path("fileId").asText(null);
            String mimeType = item.path("mimeType").asText(null);
            if (fileId == null || mimeType == null) {
                continue;
            }
            DshSdkSession.InlineImage image = uploads.asInlineImage(fileId, mimeType);
            if (image != null) {
                images.add(image);
            }
        }
        return images;
    }

    private void doStream(String sessionId, PrintWriter writer, String userText,
                          com.fasterxml.jackson.databind.JsonNode attachments) {
        // 先做前置校验：引擎不可用或会话不存在时直接抛错，由 Controller 返回错误信封，
        // 而不是先建一条永远不会有内容的连接。
        if (!harness.isAvailable()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "agent_unavailable",
                    "Agent 未接入或不可用");
        }
        ChatSession session = sessions.findById(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "会话不存在"));

        // 会话标识与「是否已在本引擎上创建过」是两件事：DSH 的会话是持久化的，
        // 子进程却是每次请求新起的。已存在的会话必须用 session/resume 续接，
        // 否则直接 prompt 会被 DSH 以「already exists」拒绝（实测）。
        boolean continuation = session.harnessSessionId() != null
                && !session.harnessSessionId().isBlank();
        String harnessSessionId = continuation
                ? session.harnessSessionId()
                : "fm-" + sessionId;

        DshProcess process = null;
        AtomicBoolean finished = new AtomicBoolean(false);
        // 分段计时：回答「每轮的进程启动到底占多少」这个问题。
        // 只有分得清 spawn / resume / 首 token / 总时长，才能判断要不要上常驻进程；
        // 当前决定是按 A 方案（每轮一个进程），这组数据用来验证该决定是否成立。
        TurnTiming timing = new TurnTiming();
        try {
            process = launcher.startSdk();
            timing.markSpawned();

            DshSdkSession driver = new DshSdkSession(
                    process, json, properties.getProvider(), properties.getModel());
            // stderr 必须在 driver 之后开始排空：插件把 token 级帧写在这里，
            // 需要直接灌进 driver 的队列，读到的帧才不会被当成诊断日志丢掉。
            process.drainStderr(200, frame -> {
                timing.markFirstDeltaIfText(frame);
                driver.acceptStreamFrame(frame);
            });

            /* 工作目录用**会话所属项目**的根目录，而不是配置里的全局目录。
               这一条决定「AI 产出的文件算谁的」：全局目录下写出的视频不属于任何项目，
               界面上也就永远看不到产物。项目的 rootPath 是创建时分配的稳定路径。 */
            driver.initialize(workingDirectoryFor(session), Duration.ofSeconds(10));
            timing.markReady();

            if (continuation) {
                // 续接：加载历史并修复可能被中断的最后一轮。失败就如实报错，
                // 不静默降级成新会话——那会让用户以为在续聊，其实上下文已丢。
                driver.resume(harnessSessionId, Duration.ofSeconds(30));
            } else {
                // 首次：绑定标识，后续轮次据此走续接分支。
                sessions.bindHarnessSession(sessionId, harnessSessionId);
            }

            final PrintWriter out = writer;
            // listener 提到局部变量：成功收尾时的 done 帧也要经过它，才能与执行期间的
            // 阶段帧共用去重状态，避免同一个 phase 发两次。
            SseListener listener = new SseListener(out, sessionId);
            List<DshSdkSession.InlineImage> images = inlineImages(attachments);
            LOG.info("prompt images: attachmentsPresent={} resolved={}",
                    attachments != null, images.size());
            DshSdkSession.Outcome outcome = driver.prompt(
                    harnessSessionId,
                    userText,
                    images,
                    listener,
                    Duration.ofMillis(properties.getTurnTimeoutMs()));

            if (outcome.failed()) {
                // 失败：发错误帧，不落库、不发 completed。前端据此显示失败而不是「已完成」。
                writeError(out, "agent_error", outcome.failure() == null ? "Agent 执行失败" : outcome.failure());
            } else {
                // 成功：先把助手消息落库，再发 completed。顺序很重要——先落库保证
                // 前端拿到 completed 时，历史接口一定已经能读到这条消息。
                ChatMessage saved = appendAssistantMessage(
                        sessionId, outcome.text(), listener.collectedToolCalls());
                // 先发 done 表达「本回合结束」，再发 completed 携带正文。
                // 前端契约里 done 是收尾 phase，缺了它界面会停在「正在思考」。
                listener.emitPhase("done", null, null);
                writeCompleted(out, saved);
            }
            writeEnd(out);
            finished.set(true);
        } catch (IOException failure) {
            // 进程/协议层失败：同样发错误帧，不假装完成。
            writeError(writer, "agent_unavailable",
                    failure.getMessage() == null ? "与引擎通信失败" : failure.getMessage());
            writeEnd(writer);
            finished.set(true);
        } finally {
            timing.markFinished();
            logTurnTiming(sessionId, continuation, timing);
            if (process != null) {
                process.close();
            }
            // 极端情况下（例如写帧时抛出 unchecked）确保连接被关闭而不是悬挂。
            if (!finished.get()) {
                writeEnd(writer);
            }
        }
    }

    /**
     * 输出一轮的分段耗时。
     *
     * <p>单独成方法而不是内联在 finally 里：这是纯观测代码，任何异常都不该影响
     * 本轮结果，包一层 try 更稳妥。</p>
     *
     * @param sessionId    会话 ID
     * @param continuation 本轮是否走续接分支
     * @param timing       计时器快照
     */
    private void logTurnTiming(String sessionId, boolean continuation, TurnTiming timing) {
        try {
            LOG.info("turn timing session={} resume={} spawn={}ms handshake={}ms firstToken={}ms total={}ms",
                    sessionId,
                    continuation,
                    timing.spawnMillis(),
                    timing.handshakeMillis(),
                    timing.firstTokenMillis(),
                    timing.totalMillis());
        } catch (RuntimeException ignored) {
            // 观测失败不影响业务。
        }
    }

    /**
     * 一轮的分段计时。
     *
     * <p>存在的理由：A 方案（每轮一个进程）是否合适，取决于进程启动在整轮里占多大
     * 比重。这个比重在不同场景下差别很大——长上下文时模型耗时可能到 20s 以上，
     * 启动只占个位数百分比；短问短答时可能过半。所以必须用真实使用数据判断，
     * 而不是靠单轮封闭测试的估值。</p>
     *
     * <p>线程安全：写入来自 stderr 排空线程（首个增量）与请求线程（其余），
     * 因此用 volatile 保证可见性；同一个字段只会被写一次（首个增量用 CAS 语义）。</p>
     */
    private static final class TurnTiming {

        /** 起始时刻。 */
        private final long startedAt = System.nanoTime();
        /** 子进程 spawn 完成时刻；0 表示未到达。 */
        private volatile long spawnedAt;
        /** 握手完成时刻。 */
        private volatile long readyAt;
        /** 首个正文增量到达时刻。 */
        private volatile long firstDeltaAt;
        /** 整轮结束时刻。 */
        private volatile long finishedAt;

        /** 记录 spawn 完成。 */
        void markSpawned() {
            spawnedAt = System.nanoTime();
        }

        /** 记录握手完成。 */
        void markReady() {
            readyAt = System.nanoTime();
        }

        /** 记录整轮结束。 */
        void markFinished() {
            finishedAt = System.nanoTime();
        }

        /**
         * 若该帧是正文增量且尚未记录，则记下首 token 时刻。
         *
         * @param frame 插件流式帧
         */
        void markFirstDeltaIfText(com.fasterxml.jackson.databind.JsonNode frame) {
            if (firstDeltaAt != 0L) {
                return;
            }
            if (!"text".equals(frame.path("params").path("kind").asText())) {
                return;
            }
            firstDeltaAt = System.nanoTime();
        }

        /** @return spawn 耗时（毫秒）；未到达时返回 -1 */
        long spawnMillis() {
            return millisBetween(startedAt, spawnedAt);
        }

        /** @return 握手耗时（毫秒），从 spawn 完成算起；未到达时返回 -1 */
        long handshakeMillis() {
            return millisBetween(spawnedAt, readyAt);
        }

        /** @return 首 token 延迟（毫秒），从握手完成算起；未到达时返回 -1 */
        long firstTokenMillis() {
            return millisBetween(readyAt, firstDeltaAt);
        }

        /** @return 整轮总耗时（毫秒） */
        long totalMillis() {
            long end = finishedAt == 0L ? System.nanoTime() : finishedAt;
            return millisBetween(startedAt, end);
        }

        /**
         * 计算两个时刻之间的毫秒数。
         *
         * @param from 起始纳秒时刻
         * @param to   结束纳秒时刻
         * @return 毫秒差；任一端未设置时返回 -1
         */
        private static long millisBetween(long from, long to) {
            if (from == 0L || to == 0L) {
                return -1L;
            }
            return (to - from) / 1_000_000L;
        }
    }

    /**
     * 把助手回复写入消息表。
     *
     * <p>与用户消息走同一条只追加路径：先取写锁再分配序号，保证 {@code (session_id, seq)}
     * 不重复。系统消息不下发，这里写的是 {@code assistant} 角色。</p>
     *
     * @param sessionId 会话 ID
     * @param text      助手正文
     * @return 已保存的消息
     */
    private ChatMessage appendAssistantMessage(String sessionId, String text,
                                               com.fasterxml.jackson.databind.JsonNode toolCalls) {
        String body = text == null || text.isBlank() ? "" : text;
        return transactions.execute(status -> {
            messages.acquireWriteLock();
            Instant now = Instant.now();
            ChatMessage saved = messages.append(new ChatMessage(
                    UUID.randomUUID().toString(),
                    sessionId,
                    0,
                    ChatMessage.ROLE_ASSISTANT,
                    body,
                    null,
                    null,
                    null,
                    // 空数组存 null：没有工具调用时不留一个 []，读回来仍是「没有」。
                    toolCalls == null || toolCalls.isEmpty() ? null : toolCalls,
                    now));
            sessions.touch(sessionId, now);
            return saved;
        });
    }

    /** 写一帧 {@code status}，用于表达「正在思考」「正在调用工具」等阶段。 */
    private void writeStatus(PrintWriter out, String phase, String toolName, String label) {
        writeStatus(out, phase, toolName, label, null, null, false);
    }

    /**
     * 写一帧 {@code status}，可附带工具调用的结构化信息。
     *
     * <p><strong>为什么要把 callId/arguments 带出去</strong>：DSH 的 {@code tool/call}
     * 事件本来就带了这些，之前只映射成「正在执行 bash」，等于把最有用的信息
     * 在后端就丢掉了。视频类应用的主要交互就是工具调用（渲染、切片、素材处理），
     * 界面要显示「在跑哪个工具、参数是什么、失败原因」就必须有结构化字段。</p>
     *
     * <p>字段都是可选的：前端旧代码只读 {@code phase}/{@code name}/{@code label}，
     * 多出字段不会破坏它（契约扩展向后兼容）。</p>
     *
     * @param out      SSE 输出
     * @param phase    阶段
     * @param toolName 工具名
     * @param label    给人看的说明
     * @param callId   工具调用 ID；与 tool_result 配对用
     * @param arguments 参数 JSON 原文；可能很长，调用方自行截断
     * @param isError  工具结果是否失败（仅在结果帧上有意义）
     */
    /**
     * 构造一帧 {@code status} 的载荷。
     *
     * <p>抽成静态方法而不是内联在 {@link #writeStatus} 里，是为了能单测
     * 「工具调用/结果帧到底带出了哪些字段」—— 这是本轮新增的对外契约，
     * 字段名写错前端就拿不到，而它不经过任何编译期检查。</p>
     *
     * @param json      JSON 工厂
     * @param phase     阶段（thinking / tool / done）
     * @param toolName  工具名；null 表示不带
     * @param label     给人看的说明；null 表示不带
     * @param callId    工具调用 ID；空表示不带
     * @param arguments 参数原文；空表示不带，过长会被截断
     * @param isError   是否工具失败；仅 true 时才写出该字段
     * @return 载荷对象
     */
    static ObjectNode statusPayload(ObjectMapper json, String phase, String toolName, String label,
                                    String callId, String arguments, boolean isError) {
        ObjectNode data = json.createObjectNode();
        data.put("type", "status");
        data.put("phase", phase);
        if (toolName != null) {
            data.put("name", toolName);
        }
        if (label != null) {
            data.put("label", label);
        }
        if (callId != null && !callId.isBlank()) {
            data.put("callId", callId);
        }
        if (arguments != null && !arguments.isBlank()) {
            data.put("arguments", truncate(arguments, MAX_ARGUMENT_CHARS));
        }
        if (isError) {
            data.put("isError", true);
        }
        return data;
    }

    private void writeStatus(PrintWriter out, String phase, String toolName, String label,
                             String callId, String arguments, boolean isError) {
        writeFrame(out, "status",
                statusPayload(json, phase, toolName, label, callId, arguments, isError));
    }

    /**
     * 截断过长的文本，保留可辨识的前缀。
     *
     * <p>工具参数可能是整段文件内容或 base64，原样塞进 SSE 会把一帧撑到几百 KB，
     * 前端解析和渲染都吃亏。截断点之后的调用方仍能从 {@code callId} 找回完整调用。</p>
     *
     * @param text      原文
     * @param maxLength 上限
     * @return 截断后的文本
     */
    private static String truncate(String text, int maxLength) {
        if (text.length() <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + "…";
    }

    /**
     * 写一帧 {@code delta}：一个 token 级文本增量。
     *
     * <p>契约（agent.md §4）要求 delta 带 {@code messageId}，但增量到达时助手消息
     * 尚未落库、还没有真实 ID。这里用一个在本次流内稳定的临时 ID，
     * 随后 {@code completed} 帧携带真实消息——前端以 completed 为准覆盖已拼接文本，
     * 因此临时 ID 只需在本流内唯一即可。</p>
     *
     * @param out        SSE 输出
     * @param messageId  本次流内稳定的助手消息占位 ID
     * @param delta      新增文本
     */
    private void writeDelta(PrintWriter out, String messageId, String delta) {
        ObjectNode data = json.createObjectNode();
        data.put("type", "delta");
        data.put("messageId", messageId);
        data.put("delta", delta);
        writeFrame(out, "delta", data);
    }

    /** 写一帧 {@code completed}，携带完整的助手消息。 */
    private void writeCompleted(PrintWriter out, ChatMessage message) {
        ObjectNode data = json.createObjectNode();
        data.put("type", "completed");
        ObjectNode body = data.putObject("message");
        body.put("id", message.id());
        body.put("sessionId", message.sessionId());
        body.put("role", message.role());
        body.put("text", message.text());
        body.put("createdAt", message.createdAt().toString());
        writeFrame(out, "completed", data);
    }

    /** 写一帧 {@code error}，形状与 {@code ApiExceptionHandler} 的错误信封一致。 */
    private void writeError(PrintWriter out, String code, String message) {
        ObjectNode data = json.createObjectNode();
        ObjectNode error = data.putObject("error");
        error.put("code", code);
        error.put("message", message);
        error.put("requestId", "req_" + UUID.randomUUID());
        writeFrame(out, "error", data);
    }

    /** 写终止帧。 */
    private void writeEnd(PrintWriter out) {
        ObjectNode data = json.createObjectNode();
        data.put("type", "end");
        writeFrame(out, "end", data);
    }

    /**
     * 写一帧 SSE。
     *
     * <p>必须 flush：SSE 依赖及时到达，攒批会让前端一直看不到进度。</p>
     */
    private void writeFrame(PrintWriter out, String event, ObjectNode data) {
        out.write("event: " + event + "\n");
        out.write("data: " + data.toString() + "\n\n");
        out.flush();
        // Tomcat 的 Writer.flush() 不保证立刻把字节推给客户端：响应还有一层缓冲。
        // 显式 flushBuffer 才能让每个 delta 帧立即到达，否则前端看到的是批量到达。
        Runnable flush = currentFlush.get();
        if (flush != null) {
            try {
                flush.run();
            } catch (RuntimeException ignored) {
                // 客户端已断开时 flush 会抛异常；连接已无用，忽略即可。
            }
        }
    }

    /** 把 SDK 事件回调翻译成 SSE 帧。 */
    private final class SseListener implements DshSdkSession.Listener {
        private final PrintWriter out;
        /** 上一次发出的 phase，用于抑制重复帧。 */
        private String lastPhase;
        /**
         * 本流内稳定的助手消息占位 ID。
         *
         * <p>delta 帧需要 messageId，但此时消息尚未落库；用流内唯一值即可，
         * 前端最终以 completed 携带的真实 ID 与全文为准。</p>
         */
        private final String pendingMessageId = "pending-" + UUID.randomUUID();
        /** 是否已经发过至少一个正文增量。 */
        private boolean streamed;
        /**
         * 本轮的工具调用记录，用于随助手消息一起落库。
         *
         * <p>按 {@code callId} 归并：开始帧建条目，结果帧回填成败。之所以在后端也记一份
         * （前端状态里已经有一份），是因为前端那份只活在组件状态里——切走会话再回来就没了，
         * 用户再也查不到「这条回复当时跑了什么」。</p>
         */
        private final List<ObjectNode> toolCalls = new java.util.ArrayList<>();

        /** 本流所属的会话 ID；用于把引擎回传的标题写回正确的会话。 */
        private final String sessionId;

        SseListener(PrintWriter out, String sessionId) {
            this.out = out;
            this.sessionId = sessionId;
        }

        /**
         * 本轮收集到的工具调用记录。
         *
         * @return 调用记录的 JSON 数组；没有调用时为空数组
         */
        com.fasterxml.jackson.databind.node.ArrayNode collectedToolCalls() {
            com.fasterxml.jackson.databind.node.ArrayNode array = json.createArrayNode();
            toolCalls.forEach(array::add);
            return array;
        }

        @Override
        public void onTextDelta(String text) {
            // 首个正文增量到达时，先把阶段从「思考」切到「输出」，让界面知道开始出字了。
            if (!streamed) {
                streamed = true;
                emitPhase("done", null, null);
            }
            writeDelta(out, pendingMessageId, text);
        }

        @Override
        public void onThinkingDelta(String text) {
            // 推理增量不写入正文：只用于说明「还在思考」，不改变已输出的答案。
            // 前端目前没有推理展示位，因此这里不发帧，避免污染正文。
        }

        /**
         * 发一个阶段帧，相同的 phase 不重复发送。
         *
         * <p>同一次执行里 {@code turn/start} 与 {@code session.status: running} 都会表达
         * 「正在思考」；不去重会让前端收到两帧同样的 thinking，状态虽不变但属于噪声。</p>
         */
        private void emitPhase(String phase, String name, String label) {
            if (phase.equals(lastPhase)) {
                return;
            }
            lastPhase = phase;
            writeStatus(out, phase, name, label);
        }

        @Override
        public void onTurnStarted(int turn) {
            emitPhase("thinking", null, null);
        }

        @Override
        public void onStepStarted(int turn, int step) {
            // 步骤开始不额外发帧：turn 开始已经表达了「在思考」，
            // 重复发会让前端状态闪烁。
        }

        @Override
        public void onToolCall(String callId, String name, String arguments) {
            /* 工具调用**不能**走 emitPhase：那个方法按 phase 去重，而一轮里连续调用
               两个工具都是 tool 相位、却是两次不同调用 —— 去重会把第二次吞掉，
               界面上就永远停在第一个工具。所以这里直接发帧，并带上 callId 让前端
               能把「调用」和「结果」配对。
               lastPhase 仍然要更新，否则紧随其后的 thinking 帧会被误判成重复。 */
            lastPhase = "tool";
            writeStatus(out, "tool", name, name, callId, arguments, false);
            // 同一份信息也记进落库用的列表：SSE 帧是「正在发生」，落库是「事后可查」。
            ObjectNode record = json.createObjectNode();
            if (callId != null && !callId.isBlank()) {
                record.put("callId", callId);
            }
            record.put("name", name == null ? "" : name);
            if (arguments != null && !arguments.isBlank()) {
                record.put("arguments", truncate(arguments, MAX_ARGUMENT_CHARS));
            }
            toolCalls.add(record);
        }

        @Override
        public void onToolResult(String callId, String text, boolean isError) {
            /* 结果帧复用 tool 相位，但带 callId + isError，前端据此把对应的调用行标成完成/失败。
               仍然发一帧而不是静默：之前静默是担心界面停在「正在调用工具」，
               但现在有 callId 配对，前端能准确知道是哪一个结束了。

               phase 保持 tool 而不是切回 thinking：一个工具结束后，模型可能马上调下一个，
               来回切 thinking/tool 会让状态灯闪烁。真正的「思考中」由后续 turn/step 事件
               或文本增量表达。 */
            writeStatus(out, "tool", null, null, callId, null, isError);
            // 落库副本回填成败与结束标记：记录里要能区分「跑过但失败」和「还没跑完」。
            if (callId != null && !callId.isBlank()) {
                for (ObjectNode record : toolCalls) {
                    if (callId.equals(record.path("callId").asText(null))) {
                        record.put("done", true);
                        if (isError) {
                            record.put("isError", true);
                        }
                        break;
                    }
                }
            }
        }

        @Override
        public void onAssistantMessage(String text, String reasoning) {
            // 正文只在整轮结束后以 completed 帧发出（此处可能还会被后续步骤覆盖），
            // 因此这里不发 delta——没有 token 级增量，也不该把中间态当最终结果。
        }

        @Override
        public void onSessionTitle(String title) {
            /* 引擎给会话命了名。落库 + 发帧两件事都要做：
               · 落库：左栏刷新后仍是这个名字，不会退回「未命名对话」
               · 发帧：用户不用刷新就能看到名字更新
               标题为空时不处理 —— 用空串覆盖会让本来有名字的会话变成无名。 */
            if (title == null || title.isBlank()) {
                return;
            }
            sessions.updateTitle(sessionId, title);

            ObjectNode data = json.createObjectNode();
            data.put("type", "title");
            data.put("title", title);
            writeFrame(out, "title", data);
        }

        @Override
        public void onUsage(DshSdkSession.Listener.TokenUsage usage) {
            /* 用量帧（契约里是可选帧，前端读到就显示，读不到就当没有）。
               负值代表「上游没给」，直接不发该字段，避免把「不知道」写成 0。 */
            ObjectNode data = json.createObjectNode();
            data.put("type", "usage");
            if (usage.inputTokens() >= 0) {
                data.put("inputTokens", usage.inputTokens());
            }
            if (usage.outputTokens() >= 0) {
                data.put("outputTokens", usage.outputTokens());
            }
            if (usage.cacheReadTokens() >= 0) {
                data.put("cacheReadTokens", usage.cacheReadTokens());
            }
            if (usage.cacheWriteTokens() >= 0) {
                data.put("cacheWriteTokens", usage.cacheWriteTokens());
            }
            if (usage.totalTokens() >= 0) {
                data.put("totalTokens", usage.totalTokens());
            }
            writeFrame(out, "usage", data);
        }

        @Override
        public void onTurnEnded(boolean failed, String reason) {
            // 成败判定交给 Outcome；这里不发帧，避免在错误帧之前先发一个误导性的状态。
        }

        @Override
        public void onIdle() {
            // 结束帧由 stream() 在落库之后统一发出，保证顺序是 completed → end。
        }
    }
}
