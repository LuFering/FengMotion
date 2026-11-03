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

    /** 默认的单次对话超时；推理型任务在慢模型上可能需要更久。 */
    public static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(180);

    /** 事件回调接口。所有方法都在调用线程（即读取事件流的线程）上执行。 */
    public interface Listener {
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
         * 一轮结束。
         *
         * @param failed 是否失败
         * @param reason 失败原因；成功时为 null
         */
        void onTurnEnded(boolean failed, String reason);

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
     * 构造一次会话驱动。
     *
     * @param channel  已启动的子进程通道
     * @param json     JSON 编解码器
     * @param provider 模型路由，例如 {@code agent2api-ecs}
     * @param model    模型 ID，例如 {@code deepseek-v4.1-flash}
     */
    public DshSdkSession(DshProcess channel, ObjectMapper json, String provider, String model) {
        this.channel = channel;
        this.stdout = channel.openStdout();
        this.json = json;
        this.provider = provider;
        this.model = model;
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
        long id = channel.nextRequestId();
        ObjectNode params = json.createObjectNode();
        params.put("cwd", cwd);
        params.put("provider", provider);
        params.put("model", model);
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

        return readUntilIdle(sessionId, listener, timeout);
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
    private Outcome readUntilIdle(String sessionId, Listener listener, Duration timeout)
            throws IOException {
        StringBuilder text = new StringBuilder();
        StringBuilder reasoning = new StringBuilder();
        boolean failed = false;
        String failure = null;
        int turn = 0;
        long deadline = System.nanoTime() + timeout.toNanos();

        while (true) {
            if (System.nanoTime() > deadline) {
                throw new IOException("等待 Agent 完成超时（" + timeout.toSeconds() + " 秒）");
            }

            // 先排空 stderr 里的 token 级增量。必须在读 stdout 之前做：
            // stdout 可能长时间没有新行，若先阻塞在那里，实时增量就全被压后了。
            drainStreamFrames(listener);

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
                // 没有可读行：说明模型还在生成。稍等后回到循环顶部再排空 stderr，
                // 这样 token 增量能按到达顺序尽快交给上层，而不是攒到最后一并处理。
                if (!channel.isAlive()) {
                    throw new IOException("DSH 子进程已退出，未收到 idle 通知");
                }
                try {
                    Thread.sleep(5);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IOException("读取被中断", interrupted);
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
                    listener.onTurnStarted(turn == 0 ? 1 : turn);
                } else if ("idle".equals(status)) {
                    listener.onIdle();
                    return new Outcome(text.toString(), reasoning.toString(), failed, failure);
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

            switch (type) {
                case "turn/start" -> {
                    turn = data.path("turn").asInt(1);
                    listener.onTurnStarted(turn);
                }
                case "step/start" -> listener.onStepStarted(
                        data.path("turn").asInt(turn), data.path("step").asInt(1));
                case "tool/call" -> listener.onToolCall(
                        data.path("callId").asText(""),
                        data.path("name").asText(""),
                        data.path("arguments").asText(""));
                case "tool/result" -> {
                    JsonNode message = data.path("message");
                    listener.onToolResult(
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
                    reasoning.setLength(0);
                    reasoning.append(think);
                    listener.onAssistantMessage(body, think);
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
                    listener.onTurnEnded(failed, failure);
                }
                default -> {
                    // 其他事件（permission/preset、request/header、session/title 等）
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
     * @param listener 目标回调
     */
    private void drainStreamFrames(Listener listener) {
        JsonNode frame;
        while ((frame = streamFrames.poll()) != null) {
            if (!"stream/delta".equals(frame.path("method").asText(""))) {
                continue;
            }
            JsonNode params = frame.path("params");
            String kind = params.path("kind").asText("");
            if ("text".equals(kind)) {
                String text = params.path("text").asText("");
                if (!text.isEmpty()) {
                    listener.onTextDelta(text);
                }
            } else if ("thinking".equals(kind)) {
                String text = params.path("text").asText("");
                if (!text.isEmpty()) {
                    listener.onThinkingDelta(text);
                }
            }
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
