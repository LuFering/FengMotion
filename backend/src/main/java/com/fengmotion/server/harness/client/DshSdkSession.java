package com.fengmotion.server.harness.client;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 通过 SDK 协议驱动一次 DSH 对话，并把会话事件流翻译成回调。
 *
 * <p>协议要点（全部来自实测与官方类型定义）：</p>
 * <ul>
 *   <li>{@code initialize} 是进程级握手，返回 {@code serverInfo}；必须成功后才能发 prompt。</li>
 *   <li>{@code session/prompt} <strong>立即返回</strong> {@code {messageId}}（入队回执），
 *       它不是回复内容。真正的结束要等 {@code session.status} 变成 {@code idle}。</li>
 *   <li>助手正文在 {@code assistant/message} 事件的 {@code data.message.content} 里，
 *       其中 {@code type=text} 是正文、{@code type=reasoning} 是推理。</li>
 *   <li>字段名是 {@code contentBlocks}，不是 {@code prompt}——写错会得到
 *       毫无提示的 {@code -32603 Cannot read properties of undefined}。</li>
 * </ul>
 *
 * <p><strong>没有 token 级增量</strong>：{@code assistant/message} 在步骤提交时才到达，
 * 所以本类只提供「阶段进度」回调，不假装能逐字推送。</p>
 */
public class DshSdkSession {

    /** 回复流心跳间隔：要明显小于前端的空闲断线判断（45 秒）。 */
    static final Duration HEARTBEAT_INTERVAL = Duration.ofSeconds(15);

    /** 测试用短间隔验证心跳；生产一律用 {@link #HEARTBEAT_INTERVAL}。 */
    Duration heartbeatInterval = HEARTBEAT_INTERVAL;

    /** 默认的单次对话超时；推理型任务在慢模型上可能需要更久。 */
    public static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(180);

    /** 事件回调接口。所有方法都在调用线程（即读取事件流的线程）上执行。 */
    public interface Listener {
        /** Transport keepalive; no synthetic progress or generated content. */
        default void onHeartbeat() { }

        /**
         * Agent 开始工作。
         *
         * @param turn 轮次号
         */
        void onTurnStarted(int turn);

        /**
         * 一个步骤开始。
         *
         * @param turn 轮次号
         * @param step 步骤号
         */
        void onStepStarted(int turn, int step);

        /**
         * 工具开始调用。
         *
         * @param callId    调用 ID
         * @param name      工具名，例如 {@code bash}
         * @param arguments 参数 JSON 文本
         */
        void onToolCall(String callId, String name, String arguments);

        /**
         * 工具调用返回。
         *
         * @param callId  调用 ID
         * @param text    返回文本
         * @param isError 是否失败
         */
        void onToolResult(String callId, String text, boolean isError);

        /**
         * 收到一个 token 级正文增量。
         *
         * <p>来自 DSH 内部的 {@code agent/assistant-stream}，由随包子进程的
         * fengmotion-stream 插件转写到 stderr。这是真正的实时流：文本逐步到达，
         * 而不是在步骤提交时整段出现。</p>
         *
         * @param text 本次新增的文本片段（可能为空串，调用方应跳过）
         */
        void onTextDelta(String text);

        default void onTextDelta(int turn, int step, String attempt, String text) { onTextDelta(text); }

        /**
         * 收到一个 token 级推理增量。
         *
         * @param text 本次新增的推理片段
         */
        void onThinkingDelta(String text);

        /**
         * 助手消息已提交。
         *
         * @param text      正文
         * @param reasoning 推理内容；没有时为空字符串
         */
        void onAssistantMessage(String text, String reasoning);

        default void onAssistantMessage(int turn, int step, String text, String reasoning) { onAssistantMessage(text, reasoning); }

        default boolean collectAfterHandoff() { return false; }

        /**
         * DSH 为会话生成的标题。
         *
         * <p>DSH 自己会发 {@code session/title}（实测载荷 {@code {title, messageSeqs, source}}），
         * 但此前被当成未知事件丢弃，导致左栏所有会话永远显示「未命名对话」。
         * 标题来源有两种：{@code source.kind = "fallback"} 表示直接取用户原话，
         * 其余（如模型生成）则更短更贴题。这里原样透传，不做二次加工。</p>
         *
         * <p>默认空实现：不是每个监听器都关心标题。</p>
         *
         * @param title 会话标题；空串表示上游没给
         */
        default void onSessionTitle(String title) {
            // 默认忽略
        }

        /**
         * 一条助手消息的 token 用量。
         *
         * <p><strong>不是独立事件</strong>：DSH 的 SDK 事件流里没有 {@code usage} 事件，
         * 用量挂在 {@code assistant/message} 的 {@code usage} 字段上（实测）。所以这里
         * 在解析该消息时顺带回调，而不是等一个永远不会来的事件。</p>
         *
         * <p>默认空实现：不是每个监听器都关心用量，接口不强制实现它。</p>
         *
         * @param usage 用量；字段缺失时对应值为 -1
         */
        default void onUsage(TokenUsage usage) {
            // 默认忽略
        }

        /**
         * 一次模型调用的 token 用量。
         *
         * <p>DSH 给的是 camelCase（{@code inputTokens} 等），{@code totalTokens}
         * 含缓存命中部分，因此不等于 input+output —— 直接透传上游值，不自己重算。</p>
         *
         * @param inputTokens      未缓存的输入 token
         * @param outputTokens     输出 token
         * @param cacheReadTokens  缓存命中读取的 token；上游未给时为 -1
         * @param cacheWriteTokens 缓存写入的 token；上游未给时为 -1
         * @param totalTokens      上游给出的总计；未给时为 -1
         */
        record TokenUsage(long inputTokens, long outputTokens, long cacheReadTokens,
                          long cacheWriteTokens, long totalTokens) {
        }

        /**
         * 当前模型的上下文容量 —— 占用率的分母。
         *
         * <p><strong>来源是 {@code request/context} 事件</strong>：DSH 每次真正发请求前
         * 记一条，带 {@code contextWindow}。实测该字段<b>可能缺失</b>（取决于适配器
         * 是否上报），所以用 -1 表示「不知道」，不补一个假的分母。</p>
         *
         * <p>别和 {@link TokenUsage} 混淆：usage 是<b>这次用了多少</b>，
         * 这里是<b>最多能用多少</b>。两者来自不同事件，更新时机也不同 ——
         * usage 每轮都变，窗口只跟模型走。</p>
         *
         * @param contextWindow 上下文窗口 token 数；上游没报时为 -1
         */
        default void onContextWindow(long contextWindow) {
            // 默认忽略
        }

        /**
         * 本次请求的工具 schema 占用的 token（估算）。
         *
         * <p>来自 {@code request/header} 事件。上下文分档里 tools 那一档
         * <b>没有别的来源</b> —— usage 只给总数，拆不出这部分。</p>
         *
         * <p>算法与 DSH 一致：工具定义的 JSON 长度 / 4（+4 结构开销）。
         * 用同一个公式是为了让界面上的数字和本机 dsh 对得上，
         * 而不是各算各的。</p>
         *
         * @param toolsTokens 工具 schema 的估算 token 数
         */
        default void onToolsTokens(long toolsTokens) {
            // 默认忽略
        }

        /**
         * 上下文分档：按内容类别拆开的估算占用。
         *
         * <p><strong>为什么需要它</strong>：{@code usage} 只给总数，用户看不到
         * 「这一堆 token 到底被什么吃掉了」，于是既判断不了要不要压缩，
         * 也不知道该清哪一块。分档把总数拆成可解释的几类。</p>
         *
         * <p><strong>分类口径参照 magpie 的 {@code prompt.parts}</strong>（实测其
         * {@code parts} 各项之和与 {@code tokens} 完全相等）：system / memory /
         * files / results / chat 五类。DSH 自己的 {@code contextBreakdown}
         * 投影只分 system / tools / message 三档，粒度不够 —— 它把附件、
         * 工具输出、对话全算进 message，正是这里要拆开的部分。</p>
         *
         * <p>每类 token 用 DSH 同一个估算公式（字符数 / 4 + 结构开销），
         * 保证与本机 dsh 的数字口径一致，不自创算法。</p>
         *
         * @param breakdown 分档快照；没出现的类别其值为 0
         */
        default void onContextBreakdown(ContextBreakdown breakdown) {
            // 默认忽略
        }

        /**
         * 一个后台任务（job）开始或结束。
         *
         * <p>DSH 把每次 bash / 长任务登记成 job，成对发 {@code job/registered} 与
         * {@code job/settled}。这两类事件以前落在 default 分支被丢弃，所以界面上
         * <b>完全看不到任务的存在</b>：慢任务期间用户只看到「卡住了」，
         * 被 kill 的任务更是无声无息（实测一个会话里 13060 个 job 有 200 个 killed）。</p>
         *
         * @param job 任务快照；结束事件带 status 与耗时
         */
        default void onJob(JobInfo job) {
            // 默认忽略
        }

        /**
         * 模型交付了一批文件（{@code present} 工具）。
         *
         * <p>这是「产物卡片」的唯一数据来源：模型做了什么、东西在哪，
         * 都靠这里。以前这条事件被整条丢弃，用户只能从正文里自己找路径。</p>
         *
         * @param files 本次交付的文件；带绝对路径与一句说明
         */
        default void onDeliverables(java.util.List<Deliverable> files) {
            // 默认忽略
        }

        /**
         * 一个交付物。
         *
         * @param path        文件路径
         * @param description 给用户看的一句说明；可能为空
         */
        record Deliverable(String path, String description) {
        }

        /**
         * 上下文分档快照。
         *
         * <p>五类互斥，合计约等于 {@code usage} 的 prompt 总量（估算口径与
         * 供应商上报口径有系统性差异，不保证精确相等 —— 界面应按「构成
         * 近似」呈现，不要当成账单）。</p>
         *
         * @param systemTokens  系统提示词（最近一条存活的 system 消息）
         * @param memoryTokens  记忆与项目规则：AGENTS.md、reminders 等
         * @param filesTokens   附件与读过的文件：图片、read 结果、shell 读取
         * @param resultsTokens 工具输出：bash 回显、浏览器快照等
         * @param chatTokens    对话正文：历史轮次与当前轮
         */
        record ContextBreakdown(long systemTokens, long memoryTokens, long filesTokens,
                                long resultsTokens, long chatTokens) {
        }

        /**
         * 一个后台任务的状态快照。
         *
         * @param jobId     任务 ID（同一任务注册与结算相同）
         * @param kind      任务类型，如 {@code bash}
         * @param label     给人看的标签，通常是命令行
         * @param status    状态：{@code running} / {@code completed} / {@code killed} / {@code failed}
         * @param durationMs 已运行毫秒；未结束时为 -1
         * @param detail    结算说明，如 {@code exit code: 0}；未结束时为 null
         */
        record JobInfo(String jobId, String kind, String label, String status,
                       long durationMs, String detail) {
        }

        /**
         * 一轮结束。
         *
         * @param failed 是否失败
         * @param reason 失败原因；成功时为 null
         */
        void onTurnEnded(boolean failed, String reason);

        /**
         * 一条「过程诊断」：压缩上下文、达到 token 上限、模型重试、被中断。
         *
         * <p>这些事件都**不改变正文**，但解释了「为什么这次回复不对劲」——
         * 上下文被压缩后模型可能忘了前文，达到 token 上限则会话被截断，
         * 重试会让等待变长。以前它们全部落在 default 分支被丢弃，
         * 用户只能看到「答复怪怪的」却没有任何线索。</p>
         *
         * <p>默认空实现：不是每个监听器都关心诊断。</p>
         *
         * @param kind  诊断类型：compaction / max-tokens / retry / interrupted
         * @param detail 给人看的一句话说明；可能为空
         */
        default void onDiagnostic(String kind, String detail) {
            // 默认忽略
        }

        /**
         * 整个 Agent 空闲，本次对话结束。
         */
        void onIdle();
    }

    /**
     * 一次对话的结果。
     *
     * @param text      最终正文；没有产出时为空字符串
     * @param reasoning 推理内容
     * @param failed    是否失败
     * @param failure   失败原因
     */
    public record Outcome(String text, String reasoning, boolean failed, String failure) {
    }

    /**
     * 什么都不做的回调实现，用于「转后台之后」的读取阶段。
     *
     * <p>转后台时 HTTP 连接已经关闭，继续往 SSE 写帧既没有读者，也可能抛异常；
     * 但读取循环仍然要继续消费事件，否则 stdout 管道会被填满而把子进程卡死。
     * 所以这里保留一个「只读不广播」的 listener：事件照常处理（正文仍在
     * {@code Outcome} 里累计），只是不再对外通知。</p>
     */
    private static final class SilentListener implements Listener {
        @Override
        public void onTurnStarted(int turn) {
        }

        @Override
        public void onStepStarted(int turn, int step) {
        }

        @Override
        public void onToolCall(String callId, String name, String arguments) {
        }

        @Override
        public void onToolResult(String callId, String text, boolean isError) {
        }

        @Override
        public void onTextDelta(String text) {
        }

        @Override
        public void onThinkingDelta(String text) {
        }

        @Override
        public void onAssistantMessage(String text, String reasoning) {
        }

        @Override
        public void onIdle() {
        }

        @Override
        public void onTurnEnded(boolean failed, String failure) {
        }
    }

    /**
     * 一张要随消息发给模型的图片。
     *
     * <p>{@code mimeType} 必须是 DSH 协议允许的四种之一（png/jpeg/webp/gif）：
     * 那是类型层面的字面量联合，传别的类型会在准入阶段被拒绝，
     * 而且错误信息不会指出是哪种格式不被接受。构造时要自己先过滤。</p>
     *
     * @param base64   base64 编码的图片字节（不含 data URI 前缀）
     * @param mimeType 图片 MIME，仅限 image/png、image/jpeg、image/webp、image/gif
     */
    public record InlineImage(String base64, String mimeType) {

        /** DSH 协议接受的图片 MIME 集合。 */
        private static final java.util.Set<String> ALLOWED =
                java.util.Set.of("image/png", "image/jpeg", "image/webp", "image/gif");

        /**
         * 判断某个 MIME 能否作为内联图片发送。
         *
         * @param mimeType 待检查的 MIME
         * @return 协议是否接受
         */
        public static boolean isSupported(String mimeType) {
            return mimeType != null && ALLOWED.contains(mimeType.toLowerCase(java.util.Locale.ROOT));
        }
    }

    private final DshProcess channel;
    private final java.io.BufferedReader stdout;
    private final ObjectMapper json;
    private final String provider;
    private final String model;
    private final String reasoningEffort;

    /**
     * 等待响应期间读到的通知帧。
     *
     * <p>{@code awaitResponse} 为了找到匹配 id 的响应会顺带读到通知帧；这些通知
     * （例如 {@code session.status: running}）是真正的业务事件，不能丢。先存起来，
     * 由 {@code readUntilIdle} 优先消费，否则「正在思考」这个阶段就永远不会上报。</p>
     */
    private final java.util.Deque<JsonNode> pendingNotifications = new java.util.ArrayDeque<>();

    /**
     * 从 stderr 收到的插件流式帧。
     *
     * <p>stderr 由独立守护线程读，这里用并发队列跨线程传递；读取方是
     * {@link #prompt} 的主循环，每轮清空一次即可（同一时刻只有一个请求在跑）。</p>
     */
    private final java.util.concurrent.BlockingQueue<JsonNode> streamFrames =
            new java.util.concurrent.LinkedBlockingQueue<>();

    /**
     * 主循环等待增量帧的最长时间（毫秒）。
     *
     * <p>它是「多久回头看一眼 stdout」的上限，不是「多久没数据就放弃」。
     * 取小值是为了让 stdout 上的协议帧（idle、assistant/message）不被压住；
     * 取值不必更小 —— poll 在帧到达时会立即返回，实时性不受这个上限影响。</p>
     */
    private static final long STREAM_POLL_MILLIS = 5;

    /**
     * 上下文分档累加器。
     *
     * <p>整个会话共用一个：分档要统计的是「此刻上下文里还剩什么」，
     * 而事件流是增量的，必须从头累积才能得到当前状态。</p>
     */
    private final ContextBreakdownMeter breakdownMeter = new ContextBreakdownMeter();

    /**
     * 会话工作目录。
     *
     * <p>分档里的 memory 一项要按目录找 AGENTS.md / CLAUDE.md，
     * 所以得把它留住 —— 只在 initialize 时出现过一次。</p>
     */
    private String cwd;

    /**
     * 构造一次会话驱动。
     *
     * @param channel  已启动的子进程通道
     * @param json     JSON 编解码器
     * @param provider 模型路由，例如 {@code agent2api-ecs}
     * @param model    模型 ID，例如 {@code deepseek-v4.1-flash}
     */
    public DshSdkSession(DshProcess channel, ObjectMapper json, String provider, String model) {
        this(channel, json, provider, model, null);
    }

    public DshSdkSession(DshProcess channel, ObjectMapper json, String provider, String model,
                         String reasoningEffort) {
        this.channel = channel;
        this.stdout = channel.openStdout();
        this.json = json;
        this.provider = provider;
        this.model = model;
        this.reasoningEffort = reasoningEffort;
    }

    /**
     * 接收一条从 stderr 解析出的插件帧。
     *
     * <p>由 {@code DshProcess.drainStderr} 的守护线程调用，跨线程写入队列。</p>
     *
     * @param frame 插件帧
     */
    public void acceptStreamFrame(JsonNode frame) {
        streamFrames.add(frame);
    }

    /**
     * 执行握手。
     *
     * <p>官方说明 {@code initialize} 成功前 prompt 会被拒绝，因此必须单独确认这一步。</p>
     *
     * @param cwd 工作目录
     * @param timeout 握手超时
     * @return 服务端标识（例如 {@code deepseek-harness-sdk-runtime}）
     * @throws IOException 协议或进程错误
     */
    public String initialize(String cwd, Duration timeout) throws IOException {
        this.cwd = cwd;
        long id = channel.nextRequestId();
        ObjectNode params = json.createObjectNode();
        params.put("cwd", cwd);
        params.put("provider", provider);
        params.put("model", model);
        if (reasoningEffort != null) {
            params.put("reasoningEffort", reasoningEffort);
        }
        channel.sendRequest(id, "initialize", params);

        JsonNode result = awaitResponse(id, timeout);
        JsonNode serverInfo = result.path("serverInfo");
        String name = serverInfo.path("name").asText("");
        if (name.isEmpty()) {
            throw new IOException("initialize 响应缺少 serverInfo.name");
        }
        return name;
    }

    /**
     * 续接一个已存在的持久会话。
     *
     * <p>SDK 子进程是「一次请求一个进程」，而 DSH 的会话是持久化的。若不先 resume 就直接
     * prompt，DSH 会因为「该会话已在本进程中创建过」而拒绝（实测报
     * {@code session "..." already exists}）。因此续接必须显式调用本方法。</p>
     *
     * <p>resume 成功返回 {@code {}}；会话不存在或被占用时返回错误。</p>
     *
     * @param sessionId 要续接的会话标识
     * @param timeout   超时
     * @throws IOException 续接失败时抛出
     */
    public void resume(String sessionId, Duration timeout) throws IOException {
        long id = channel.nextRequestId();
        ObjectNode params = json.createObjectNode();
        params.put("sessionId", sessionId);
        channel.sendRequest(id, "session/resume", params);
        awaitResponse(id, timeout);
    }

    /**
     * 发送一条用户消息并读取事件流直到 Agent 空闲。
     *
     * <p>本方法阻塞直到整轮结束；{@code listener} 的 {@code onAssistantMessage}
     * 会在正文提交时被调用一次（没有 token 级增量）。</p>
     *
     * @param sessionId DSH 侧会话标识；同一个值会持续对应同一段对话
     * @param text      用户消息正文
     * @param listener  事件回调
     * @param timeout   整轮超时
     * @return 本轮结果
     * @throws IOException 协议或进程错误
     */
    public Outcome prompt(String sessionId, String text, Listener listener, Duration timeout)
            throws IOException {
        return prompt(sessionId, text, java.util.List.of(), listener, timeout);
    }

    /**
     * 发送一条带图片的用户消息。
     *
     * <p>图片走 DSH 的 {@code SdkEncodedImageBlock}：内联 base64 交给运行时的附件库，
     * 由它存成内容寻址引用后再进模型上下文（见 {@code dsh-sdk-protocol} 的类型定义）。
     * 也就是说我们只需把字节送进去，持久化与去重由 DSH 负责。</p>
     *
     * <p><strong>只支持四种栅格格式</strong>（png/jpeg/webp/gif）——这是协议里的字面量
     * 联合类型，传别的会在准入阶段被拒。调用方须先过滤，不要把不支持的类型塞进来。</p>
     *
     * @param sessionId DSH 侧会话标识
     * @param text      用户消息正文
     * @param images    随消息发送的图片；空列表表示纯文本
     * @param listener  事件回调
     * @param timeout   整轮超时
     * @return 本轮结果
     * @throws IOException 协议或进程错误
     */
    public Outcome prompt(String sessionId, String text, java.util.List<InlineImage> images,
                          Listener listener, Duration timeout)
            throws IOException {
        return prompt(sessionId, text, images, listener, timeout, null, null);
    }

    /**
     * 发送一条带图片的用户消息，并支持「转后台继续跑」。
     *
     * <p><strong>为什么需要前台截止时间</strong>：视频制作这类任务的单轮耗时
     * 经常超过浏览器愿意等的时间，但直接按超时杀掉进程又会把已经跑了一半的
     * 工作白扔。所以拆成两段：{@code foreground} 之内正常推送事件；
     * 超过之后调用 {@code onHandoff} 通知调用方「转后台了」，
     * 本方法继续阻塞读取，但不再回调 listener —— 直到任务自然结束或
     * 达到 {@code timeout} 这个硬上限。调用方在 onHandoff 里做完交接后，
     * 就能让 HTTP 连接正常关闭，而后台线程仍在等这一轮跑完。</p>
     *
     * @param sessionId   DSH 侧会话标识
     * @param text        用户消息正文
     * @param images      随消息发送的图片
     * @param listener    事件回调；转后台后不再调用
     * @param timeout     整轮硬上限
     * @param foreground  前台推送上限；null 表示全程在前台
     * @param onHandoff   超过前台上限时调用一次；null 表示不支持转后台
     * @return 本轮结果
     * @throws IOException 协议或进程错误
     */
    public Outcome prompt(String sessionId, String text, java.util.List<InlineImage> images,
                          Listener listener, Duration timeout,
                          Duration foreground, Runnable onHandoff)
            throws IOException {
        long id = channel.nextRequestId();
        ObjectNode params = json.createObjectNode();
        params.put("sessionId", sessionId);
        ArrayNode blocks = params.putArray("contentBlocks");
        ObjectNode block = json.createObjectNode();
        block.put("type", "text");
        block.put("text", text);
        blocks.add(block);
        /* 图片块跟在文本块之后：DSH 会把内联 base64 交给附件库存成内容寻址引用，
           再进模型上下文。顺序上文字在前，模型先读到「用户说了什么」，
           再看图，理解成本更低。 */
        if (images != null) {
            for (InlineImage image : images) {
                ObjectNode imageBlock = json.createObjectNode();
                imageBlock.put("type", "image");
                imageBlock.put("data", image.base64());
                imageBlock.put("mimeType", image.mimeType());
                blocks.add(imageBlock);
            }
        }
        channel.sendRequest(id, "session/prompt", params);

        // session/prompt 的响应只是入队回执，收到后不能当作「已回复」。
        awaitResponse(id, timeout);

        return readUntilIdle(sessionId, listener, timeout, foreground, onHandoff);
    }

    /**
     * 读取事件流，直到该会话的 status 变成 idle。
     *
     * @param sessionId 关注的会话
     * @param listener  回调
     * @param timeout   超时
     * @return 本轮结果
     * @throws IOException 读流失败或超时
     */
    private Outcome readUntilIdle(String sessionId, Listener listener, Duration timeout,
                                  Duration foreground, Runnable onHandoff)
            throws IOException {
        StringBuilder text = new StringBuilder();
        ReasoningTrace reasoning = new ReasoningTrace();
        boolean failed = false;
        String failure = null;
        int turn = 0;
        int step = 0;
        long start = System.nanoTime();
        long deadline = start + timeout.toNanos();
        long foregroundDeadline = foreground == null
                ? Long.MAX_VALUE
                : start + foreground.toNanos();
        /* 是否已经转后台。一旦置位就不再回调 listener：
           此时 HTTP 连接可能已经关闭，继续往里写只会产生无意义的异常，
           更重要的是——转后台的语义是「用户不再盯着看」，不该再假装在实时推送。 */
        boolean handedOff = false;
        // 转后台后用来吞掉所有对外回调，同时照常累计结果。
        SilentListener sink = new SilentListener();
        long lastHeartbeat = System.nanoTime();

        while (true) {
            if (!handedOff && System.nanoTime() > foregroundDeadline) {
                handedOff = true;
                if (onHandoff != null) {
                    try {
                        onHandoff.run();
                    } catch (RuntimeException ignored) {
                        // 交接失败不能影响任务本身继续执行。
                    }
                }
            }
            Listener active = handedOff && !listener.collectAfterHandoff() ? sink : listener;
            /* 工具调用期间（一条 bash 可能跑一分钟）DSH 什么都不发，回复流随之没有数据，
               前端 45 秒收不到字节就按断线重连。按固定间隔发心跳，放在这个单线程循环里，
               不会和别的帧交错写出。 */
            if (System.nanoTime() - lastHeartbeat >= heartbeatInterval.toNanos()) {
                lastHeartbeat = System.nanoTime();
                active.onHeartbeat();
            }
            if (System.nanoTime() > deadline) {
                throw new IOException("等待 Agent 完成超时（" + timeout.toSeconds() + " 秒）");
            }

            // 先排空 stderr 里的 token 级增量。必须在读 stdout 之前做：
            // stdout 可能长时间没有新行，若先阻塞在那里，实时增量就全被压后了。
            drainStreamFrames(sessionId, active, reasoning);

            // 再消费等待响应期间缓存的通知，否则 prompt 阶段收到的 running 会丢失。
            JsonNode frame;
            if (!pendingNotifications.isEmpty()) {
                frame = pendingNotifications.pollFirst();
            } else if (stdout.ready()) {
                String line = DshProcess.readLine(stdout);
                if (line == null) {
                    throw new IOException("DSH 子进程 stdout 已关闭，未收到 idle 通知");
                }
                if (line.isBlank()) {
                    continue;
                }
                frame = parseFrame(line);
                if (frame == null) {
                    continue;
                }
            } else {
                /* 没有可读行：模型还在生成，正文增量在 stderr 队列里。
                   这里**必须阻塞等队列**，不能 sleep 后再回来排空 ——
                   sleep 期间到达的增量会全部堆在队列里，下一轮被一次性排空，
                   界面表现就是「整段一下出现」而不是逐字打出来
                   （实测 46 个增量帧只落在 5 个时刻，其中 18 帧挤在同一毫秒）。

                   同时保留 stdout 的可读性检查：stdout 上的协议帧（idle、
                   assistant/message 等）随时可能先到，睡眠期间也要能被处理。
                   所以用带超时的 poll，醒来后两种通道都会在循环顶部重新检查。 */
                if (!channel.isAlive()) {
                    throw new IOException("DSH 子进程已退出，未收到 idle 通知");
                }
                /* 等待时长必须远小于整轮超时：这条 stdout 上随时可能来 idle /
                   assistant/message，若在这里一觉睡到 deadline，协议帧会一直被压着，
                   表现就是「完全没有回复」。实测：没装流式插件时队列永远为空，
                   阻塞到整轮超时，界面完全没有结果 —— 必须用短超时反复回来看 stdout。
                   poll 是事件驱动的：帧一到立刻返回，不会像 sleep 那样白等到期。 */
                long wait = Math.min(timeoutRemaining(deadline), STREAM_POLL_MILLIS * 1_000_000L);
                JsonNode pending = awaitStreamFrame(wait);
                if (pending != null) {
                    dispatchStreamFrame(sessionId, pending, active, reasoning);
                }
                continue;
            }
            if (frame.has("id") && !frame.has("method")) {
                // 这是某个请求的响应；prompt 的响应已在上面消费，这里忽略迟到响应。
                continue;
            }
            String method = frame.path("method").asText("");
            JsonNode params = frame.path("params");

            if ("session.status".equals(method)) {
                String status = params.path("status").asText("");
                if (!sessionId.equals(params.path("sessionId").asText(""))) {
                    continue;
                }
                if ("running".equals(status)) {
                    active.onTurnStarted(turn == 0 ? 1 : turn);
                } else if ("idle".equals(status)) {
                    /* 退出前必须再排空一次 stderr。
                       stderr 由独立线程写入队列，到达顺序与 stdout 的通知不保证同步；
                       推理增量（reasoning-delta）经常紧跟在 idle 之后才被读到，
                       直接 return 会把它们全部丢掉 —— 表现是「插件明明收到了推理帧，
                       后端一次都没回调」，而正文增量因为先到所以正常。 */
                    drainStreamFrames(sessionId, active, reasoning);
                    active.onIdle();
                    return new Outcome(text.toString(), reasoning.result(), failed, failure);
                }
                continue;
            }

            if (!"session.event".equals(method)) {
                continue;
            }
            if (!sessionId.equals(params.path("sessionId").asText(""))) {
                continue;
            }

            JsonNode event = params.path("event");
            String type = event.path("type").asText("");
            JsonNode data = event.path("data");

            /* 每个事件都要喂给分档累加器 —— 它自己判断哪些类型参与统计、
               哪些（压缩、替换）要扣掉旧内容。放在 switch 之前是为了
               不漏掉任何 surface 事件。 */
            breakdownMeter.accept(type, event.path("seq").asLong(-1),
                    event.path("surfaceOp"), data);

            switch (type) {
                case "turn/start" -> {
                    turn = data.path("turn").asInt(1);
                    step = 0;
                    active.onTurnStarted(turn);
                }
                case "step/start" -> {
                    step = data.path("step").asInt(step + 1);
                    active.onStepStarted(data.path("turn").asInt(turn), step);
                }
                case "tool/call" -> active.onToolCall(
                        data.path("callId").asText(""),
                        data.path("name").asText(""),
                        data.path("arguments").asText(""));
                case "tool/result" -> {
                    JsonNode message = data.path("message");
                    active.onToolResult(
                            message.path("toolCallId").asText(""),
                            collectText(message.path("content")),
                            message.path("isError").asBoolean(false));
                }
                case "session/title" -> {
                    // DSH 自己会命名会话；不透传的话左栏只能显示「未命名对话」。
                    listener.onSessionTitle(data.path("title").asText(""));
                }
                case "assistant/message" -> {
                    JsonNode message = data.path("message");
                    String body = collectText(message.path("content"));
                    String think = collectReasoning(message.path("content"));
                    text.setLength(0);
                    text.append(body);
                    /* 不再 setLength(0) 覆盖：推理是逐块攒起来的，
                       这里覆盖会把前面步骤的推理冲掉；交给 ReasoningTrace 去重。 */
                    reasoning.appendMessageReasoning(think);
                    active.onAssistantMessage(data.path("turn").asInt(turn), data.path("step").asInt(step), body, think);
                    // 用量挂在消息上而不是独立事件（实测）：在同一个分支里顺带取出。
                    // 缺字段用 -1 表示「上游没给」，不用 0 —— 0 是「用了 0 个 token」，
                    // 与「不知道用了多少」是两件事，界面上不该混为一谈。
                    JsonNode usage = data.path("usage");
                    listener.onUsage(new Listener.TokenUsage(
                            usage.path("inputTokens").asLong(-1),
                            usage.path("outputTokens").asLong(-1),
                            usage.path("cacheReadTokens").asLong(-1),
                            usage.path("cacheWriteTokens").asLong(-1),
                            usage.path("totalTokens").asLong(-1)));
                }
                case "turn/end" -> {
                    JsonNode reason = data.path("reason");
                    String kind = reason.path("kind").asText("completed");
                    failed = !"completed".equals(kind);
                    failure = failed ? describeFailure(reason) : null;
                    /* 分档在一轮结束时上报一次：它的数字只在本轮消息全部落地后
                       才稳定，轮中上报会给出一个不断跳动的中间值。 */
                    active.onContextBreakdown(breakdownMeter.snapshot(cwd));
                    active.onTurnEnded(failed, failure);
                }
                /* ── 过程诊断 ──────────────────────────────────────
                   这几类事件不改变正文，但解释「为什么这次结果不对劲」。
                   以前全部落进 default 被丢弃，用户看到的是「答复怪怪的」
                   却没有任何线索。现在统一上报成诊断，由界面择要提示。 */
                case "compaction/start", "manual-compaction" ->
                        listener.onDiagnostic("compaction", "上下文已满，正在压缩历史记录");
                case "compaction/summary" ->
                        listener.onDiagnostic("compaction", "上下文已压缩，早期对话被摘要替代");
                case "compaction/end" ->
                        listener.onDiagnostic("compaction", "上下文压缩完成");
                case "turn-max-tokens" -> {
                    /* 达到本回合 token 上限：答复是被截断的，不是写完了。
                       这必须让用户知道 —— 否则会以为模型就是说了一半。 */
                    listener.onDiagnostic("max-tokens", "本回合达到 token 上限，回复可能不完整");
                    failed = true;
                    if (failure == null) {
                        failure = "本回合达到 token 上限，回复被截断";
                    }
                }
                case "llm/retry", "llm/retry-started" -> {
                    String why = data.path("error").path("message").asText("");
                    listener.onDiagnostic("retry",
                            why.isBlank() ? "模型调用失败，正在重试" : "模型调用失败，正在重试：" + why);
                }
                /* DSH 每次真正发请求前记一条请求上下文，带 contextWindow。
                   这是上下文占用率的分母的唯一来源 —— usage 帧只给分子。
                   字段缺失（适配器没上报）时传 -1，让上层知道「不知道」，
                   而不是拿一个猜的数字去除。 */
                /* 后台任务（bash / 长任务）。成对出现：registered 表示开始，
                   settled 带 status 与耗时。以前全落 default 被丢弃 ——
                   慢任务期间用户只看到「卡住」，被 kill 也无声无息。 */
                case "job/registered" -> listener.onJob(new Listener.JobInfo(
                        data.path("jobId").asText(""),
                        data.path("kind").asText(""),
                        data.path("label").asText(""),
                        "running",
                        -1L,
                        null));
                case "job/settled" -> {
                    long started = data.path("startedAt").asLong(0);
                    long finished = data.path("finishedAt").asLong(0);
                    long duration = (started > 0 && finished >= started) ? finished - started : -1L;
                    String detail = data.path("detail").asText("");
                    listener.onJob(new Listener.JobInfo(
                            data.path("jobId").asText(""),
                            data.path("kind").asText(""),
                            data.path("label").asText(""),
                            data.path("status").asText("completed"),
                            duration,
                            detail.isBlank() ? null : detail));
                }
                /* 模型交付的文件（present 工具）。这是产物卡片的唯一来源 ——
                   以前整条丢弃，用户只能从正文里自己找路径。 */
                case "deliverables/presented" -> {
                    JsonNode files = data.path("files");
                    if (files.isArray() && !files.isEmpty()) {
                        java.util.List<Listener.Deliverable> list = new java.util.ArrayList<>();
                        for (JsonNode f : files) {
                            String path = f.path("path").asText("");
                            if (path.isBlank()) {
                                continue;
                            }
                            String desc = f.path("description").asText("");
                            list.add(new Listener.Deliverable(path, desc.isBlank() ? null : desc));
                        }
                        if (!list.isEmpty()) {
                            listener.onDeliverables(list);
                        }
                    }
                }
                case "request/context" -> {
                    JsonNode window = data.path("contextWindow");
                    if (window.isNumber()) {
                        active.onContextWindow(window.asLong());
                    }
                }
                /* 本次请求的工具 schema。上下文分档里 tools 那一档的唯一来源 ——
                   除了它，别处都拿不到「工具定义占了多少 token」。
                   按 DSH 自己的估算公式（JSON 长度 / 4）算，保证与本机 dsh
                   界面上的数字口径一致，不自创算法。 */
                case "request/header" -> {
                    JsonNode tools = data.path("header").path("tools");
                    if (tools.isArray() && !tools.isEmpty()) {
                        long chars = tools.toString().length();
                        /* 向上取整，与 DSH 的 estimateToolsTokens 一致
                           （Math.ceil(len/4)+4）。用整数除法会在边界上少算 1。 */
                        long tokens = (chars + 3) / 4 + 4;
                        breakdownMeter.setToolsTokens(tokens);
                        active.onToolsTokens(tokens);
                    }
                }
                default -> {
                    // 其他事件（permission/preset 等）
                    // 不影响本轮结果，按协议忽略即可。
                }
            }
        }
    }

    /**
     * 把 stderr 队列里的插件帧转成 listener 回调。
     *
     * <p>只处理 {@code stream/delta}；其余 method 忽略。帧的 {@code kind} 决定回调类型：
     * {@code text} 是正文增量、{@code thinking} 是推理增量。</p>
     *
     * <p><strong>推理为什么需要去重</strong>：同一条通道上，推理可能既有 token 级
     * {@code reasoning-delta}，又有块结束时的 {@code block_end}（带整块正文）。
     * 两条都收会把同一段思考记两遍 —— 界面上显示重复，落库也重复。
     * 这里按「块」记账：块内先到增量就标记已下发，块结束时不再补发整块；
     * 只有整块先行（没有增量）的情况才用整块正文。正文（text）不受影响。</p>
     *
     * @param listener 目标回调
     * @param reasoning 本轮推理正文的累加器；由调用方创建并最终读走
     */
    private void drainStreamFrames(String sessionId, Listener listener, ReasoningTrace reasoning) {
        JsonNode frame;
        while ((frame = streamFrames.poll()) != null) {
            dispatchStreamFrame(sessionId, frame, listener, reasoning);
        }
    }

    /**
     * 把一条插件流式帧翻译成回调。
     *
     * <p>抽成独立方法，是因为它有两个调用方：主循环开工前的批量排空，
     * 以及「stdout 没东西可读」时的逐帧阻塞等待。两处必须用同一套翻译，
     * 否则同一种帧在两条路径上表现不一致。</p>
     *
     * @param frame     插件帧
     * @param listener  目标回调
     * @param reasoning 推理累加器
     */
    private void dispatchStreamFrame(String sessionId, JsonNode frame, Listener listener, ReasoningTrace reasoning) {
        if (!"stream/delta".equals(frame.path("method").asText(""))) {
            return;
        }
        JsonNode params = frame.path("params");
        if (params.hasNonNull("sessionId") && !sessionId.equals(params.path("sessionId").asText())) return;
        String kind = params.path("kind").asText("");
        if ("text".equals(kind)) {
            String text = params.path("text").asText("");
            if (!text.isEmpty()) {
                if (params.path("turn").isIntegralNumber() && params.path("step").isIntegralNumber() && params.path("attemptId").isTextual()) {
                    listener.onTextDelta(params.get("turn").intValue(), params.get("step").intValue(), params.get("attemptId").textValue(), text);
                } else listener.onTextDelta(text);
            }
        } else if ("thinking".equals(kind)) {
            String text = params.path("text").asText("");
            if (!text.isEmpty()) {
                reasoning.appendDelta(text);
                listener.onThinkingDelta(text);
            }
        } else if ("block_end".equals(kind)) {
            /* 推理块的完整正文。有的通道只给整块、不给增量，所以这条必须收；
               但同一块若已经通过 reasoning-delta 增量下发过，再收整块就是重复。
               正文块（blockType=text）不走这里：正文有 text-delta 增量，
               再收一次整块会重复。 */
            if ("reasoning".equals(params.path("blockType").asText(""))) {
                String text = params.path("text").asText("");
                if (reasoning.appendBlockOnce(text)) {
                    listener.onThinkingDelta(text);
                }
            }
        }
    }

    /**
     * 阻塞等待下一条插件流式帧，直到超时。
     *
     * <p>为什么不再是「sleep 5ms 再回主循环排空」：睡眠期间到达的增量会全部
     * 堆在队列里，下一轮被一次性排空 —— 界面看到的是整段文字瞬间出现，
     * 而不是逐字打出来。实测 46 个增量帧只落在 5 个时刻，其中 18 帧挤在同
     * 一毫秒，打字机效果完全消失。改为在这里阻塞等待，帧一到就立刻下发。</p>
     *
     * @param nanos 最多等待的纳秒数
     * @return 下一条帧；超时返回 null（调用方回主循环重新检查 stdout / 超时）
     * @throws IOException 等待被中断时抛出
     */
    private JsonNode awaitStreamFrame(long nanos) throws IOException {
        if (nanos <= 0) {
            return null;
        }
        try {
            return streamFrames.poll(Math.max(1, nanos), java.util.concurrent.TimeUnit.NANOSECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IOException("读取被中断", interrupted);
        }
    }

    /** 距 deadline 还剩多少纳秒；已过期返回 0。 */
    private long timeoutRemaining(long deadline) {
        return Math.max(0, deadline - System.nanoTime());
    }

    /**
     * 一轮对话里累积到的推理正文。
     *
     * <p>推理有三条可能来源：token 级 {@code reasoning-delta}、块结束时的整块正文、
     * 以及 {@code assistant/message} 附带的整份推理。三处都写同一个累加器，就必须
     * 在这里统一去重 —— 否则界面上和库里都会出现「同一段思考重复两遍」。</p>
     */
    private static final class ReasoningTrace {
        private final StringBuilder text = new StringBuilder();
        /** 是否已经通过 assistant/message 收过整份推理。 */
        private boolean messageSeen;

        /** 追加一段推理增量。 */
        void appendDelta(String chunk) {
            text.append(chunk);
        }

        /**
         * 追加一整块推理正文，但**已经通过增量下发过的部分不重复追加**。
         *
         * <p>为什么用「内容比对」而不是「按块标记」：实测块事件的到达顺序是交错的 ——
         * {@code block-start(reasoning)} → 若干 {@code reasoning-delta} →
         * {@code block-start(text)} → 正文增量 → 最后才 {@code block-end(reasoning)}。
         * 推理块的结束事件排在下一个块开始之后，任何「当前打开的是哪个块」的标记
         * 都会被正文块冲掉，去重随之失效（实测正是这样把 178 字重复存了一遍）。
         * 直接比对累积文本的结尾最稳：同一段内容不论以增量还是整块到达，只记一次。</p>
         *
         * @param whole 整块推理正文
         * @return 是否真的追加了（调用方据此决定要不要再发给前端）
         */
        boolean appendBlockOnce(String whole) {
            if (whole == null || whole.isEmpty()) {
                return false;
            }
            if (text.length() >= whole.length()
                    && text.substring(text.length() - whole.length()).contentEquals(whole)) {
                return false;
            }
            text.append(whole);
            return true;
        }

        /**
         * {@code assistant/message} 附带的整份推理。
         *
         * <p>只在还没收到任何推理时采用：实测走 SSE 时它是空的（{@code reasoning.len=0}），
         * 但别的通道可能只给这一份。已经有内容时不能覆盖 —— 那会把逐块攒起来的
         * 多步推理冲成最后一步。</p>
         */
        void appendMessageReasoning(String whole) {
            if (whole == null || whole.isBlank() || messageSeen || text.length() > 0) {
                return;
            }
            messageSeen = true;
            text.append(whole);
        }

        /** 最终推理正文；没有推理时为空串。 */
        String result() {
            return text.toString();
        }
    }

    /**
     * 等待指定 id 的响应。
     *
     * <p>等待期间可能夹带通知帧；协议允许通知与响应交错，所以不能假设「下一行就是响应」。</p>
     *
     * @param id      请求 ID
     * @param timeout 超时
     * @return 响应中的 {@code result}
     * @throws IOException 超时、子进程退出或收到错误响应
     */
    private JsonNode awaitResponse(long id, Duration timeout) throws IOException {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (true) {
            if (System.nanoTime() > deadline) {
                throw new IOException("等待 JSON-RPC 响应超时（id=" + id + "）");
            }
            String line = DshProcess.readLine(stdout);
            if (line == null) {
                throw new IOException("DSH 子进程 stdout 已关闭（等待 id=" + id + "）");
            }
            if (line.isBlank()) {
                continue;
            }
            JsonNode frame = parseFrame(line);
            if (frame == null) {
                continue;
            }
            if (!frame.has("id") || frame.path("id").asLong(-1) != id) {
                // 不是目标响应：若是通知帧就缓存下来，交给事件流处理，不能丢。
                if (frame.has("method")) {
                    pendingNotifications.addLast(frame);
                }
                continue;
            }
            JsonNode error = frame.path("error");
            if (!error.isMissingNode() && !error.isNull()) {
                throw new IOException("JSON-RPC 错误："
                        + error.path("code").asInt()
                        + " " + error.path("message").asText(""));
            }
            return frame.path("result");
        }
    }

    /**
     * 解析一行帧；无法解析时返回 null 而不是抛异常。
     *
     * <p>官方协议明确「malformed JSON lines are ignored」，跟随这一约定可以避免
     * 因为一行诊断混入而中断整轮对话。</p>
     *
     * @param line 原始行
     * @return 解析结果；失败时为 null
     */
    private JsonNode parseFrame(String line) {
        try {
            return json.readTree(line);
        } catch (IOException malformed) {
            return null;
        }
    }

    /** 从内容块数组中拼接所有 text 块的文本。 */
    private static String collectText(JsonNode content) {
        if (content == null || !content.isArray()) {
            return "";
        }
        List<String> parts = new ArrayList<>();
        for (JsonNode block : content) {
            if ("text".equals(block.path("type").asText("")) && block.path("text").isTextual()) {
                parts.add(block.path("text").asText());
            }
        }
        return String.join("\n", parts);
    }

    /** 从内容块数组中拼接所有 reasoning 块的文本。 */
    private static String collectReasoning(JsonNode content) {
        if (content == null || !content.isArray()) {
            return "";
        }
        List<String> parts = new ArrayList<>();
        for (JsonNode block : content) {
            if ("reasoning".equals(block.path("type").asText("")) && block.path("text").isTextual()) {
                parts.add(block.path("text").asText());
            }
        }
        return String.join("\n", parts);
    }

    /** 把 {@code turn/end} 的 reason 描述成一句人话，尽量保留原始错误码。 */
    private static String describeFailure(JsonNode reason) {
        JsonNode error = reason.path("error");
        String message = error.path("message").asText("");
        String code = error.path("code").asText("");
        if (!message.isEmpty() && !code.isEmpty()) {
            return code + ": " + message;
        }
        if (!message.isEmpty()) {
            return message;
        }
        return reason.path("kind").asText("error");
    }
}
