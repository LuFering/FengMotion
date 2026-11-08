package com.fengmotion.server.harness.client;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 把一个会话的事件流折算成「上下文被什么吃掉了」的分档。
 *
 * <p><strong>为什么要自己算</strong>：{@code usage} 只给一个总数，
 * 用户看到「已用 34 万 token」却不知道哪一块在膨胀，于是判断不了
 * 该不该压缩、该清什么。DSH 自带的 {@code contextBreakdown} 投影只分
 * system / tools / message 三档，把附件、工具输出、对话全算进 message，
 * 粒度不足以回答这个问题。</p>
 *
 * <p><strong>分类口径参照 magpie 的 {@code prompt.parts}</strong>。实测其
 * {@code parts} 各项之和与 {@code tokens} 完全相等，说明这套分类是可用的：
 * system / tools / memory / files / results / chat。这里逐项对齐。</p>
 *
 * <p><strong>三个必须处理的陷阱</strong>（都是实测踩出来的）：</p>
 * <ol>
 *   <li><b>压缩过的内容不再占上下文</b>：{@code compaction/summary} 与
 *       {@code compaction/prune} 带 {@code shadowedSeqs}，那些消息已被摘要替代。
 *       不排除会把真实占用虚高数倍（实测一个会话从 1.3M 虚报成 11M）。</li>
 *   <li><b>{@code surfaceOp=replace} 是替换不是新增</b>：{@code system/message}
 *       每轮重写都发一条 replace，把旧的那条顶掉。当成新增会累加出
 *       完全错误的 system 数字（实测 31 次重写累加成 6.6 万，实际只有 2 千）。</li>
 *   <li><b>{@code tool/result} 不带工具名</b>：只有 {@code toolCallId}，
 *       必须回查 {@code tool/call} 才知道这是「读文件」还是「bash 回显」。
 *       不查就只能全塞进一类，files / results 分不开。</li>
 * </ol>
 *
 * <p>因此这里维护一个按 {@code seq} 索引的存活表：先按事件顺序应用
 * append / replace / shadow，最后对存活节点求和。这和 DSH 自己的
 * surface 折叠语义一致。</p>
 */
final class ContextBreakdownMeter {

    /** DSH 估算公式的字符密度：每 4 个字符约 1 token。 */
    private static final int CHARS_PER_TOKEN = 4;
    /** 每个内容块的结构开销（JSON 框架、类型标签）。 */
    private static final int BLOCK_OVERHEAD = 4;
    /** 每条消息的角色开销。 */
    private static final int ROLE_OVERHEAD = 4;

    /** 读取文件内容的工具：其结果算「文件」而不是「工具输出」。 */
    private static final List<String> FILE_TOOLS = List.of("read", "read_image");

    /** 参与 surface 的消息类事件。 */
    private static final List<String> SURFACE_TYPES = List.of(
            "system/message", "developer/message", "user/message",
            "assistant/message", "tool/result");

    /** 一个存活消息节点的分档占用。 */
    private record Node(long system, long files, long results, long chat) {
    }

    /** 存活节点：seq → 分档。 */
    private final Map<Long, Node> alive = new HashMap<>();
    /** toolCallId → 工具名，用来判断 tool/result 该归哪一档。 */
    private final Map<String, String> callNames = new HashMap<>();

    /** 累计的工具 schema 占用，来自 request/header。 */
    private long toolsTokens;

    /**
     * 吃进一个会话事件。
     *
     * <p>不认识的类型直接忽略 —— DSH 的事件类型是开放集合，
     * 遇到新类型时静默跳过比抛异常安全。</p>
     *
     * @param type      事件类型
     * @param seq       事件序号；缺失时为 -1
     * @param surfaceOp 该事件的 surface 操作，来自事件**顶层**
     *                  （不是 data 里）；非 surface 事件为 null
     * @param data      事件载荷
     */
    void accept(String type, long seq, JsonNode surfaceOp, JsonNode data) {
        /* 先记 tool-call 的名字：结果事件可能比调用事件晚很多到达，
           也可能调用所在的消息先被压缩掉、只剩结果存活。 */
        if ("assistant/message".equals(type) || "tool/call".equals(type)) {
            rememberCallNames(data.path("message").path("content"));
            if ("tool/call".equals(type)) {
                callNames.put(data.path("callId").asText(""), data.path("name").asText(""));
            }
        }

        /* 压缩：被摘要替代的消息不再占上下文 */
        if ("compaction/summary".equals(type) || "compaction/prune".equals(type)) {
            JsonNode shadowed = data.path("shadowedSeqs");
            if (shadowed.isArray()) {
                for (JsonNode s : shadowed) {
                    alive.remove(s.asLong());
                }
            }
            return;
        }

        if (!SURFACE_TYPES.contains(type)) {
            return;
        }

        if (seq < 0) {
            return;
        }

        /* replace：把被替换的节点摘掉，再放新节点。
           surfaceOp 在事件顶层 —— 读 data 里的同名键永远拿不到，
           表现就是「每次重写都当成新增」，system 会被累加几十倍。 */
        if (surfaceOp != null && surfaceOp.isObject()
                && "replace".equals(surfaceOp.path("op").asText(""))) {
            long start = surfaceOp.path("startSeq").asLong(-1);
            long end = surfaceOp.path("endSeq").asLong(-1);
            if (start >= 0 && end >= start) {
                for (long s = start; s <= end; s++) {
                    alive.remove(s);
                }
            }
        }

        alive.put(seq, priceMessage(type, data.path("message")));
    }

    /** 记下 assistant 消息里每个 tool-call 的名字。 */
    private void rememberCallNames(JsonNode content) {
        if (content == null || !content.isArray()) {
            return;
        }
        for (JsonNode block : content) {
            if ("tool-call".equals(block.path("type").asText(""))) {
                callNames.put(block.path("id").asText(""), block.path("name").asText(""));
            }
        }
    }

    /** 设置工具 schema 的占用。 */
    void setToolsTokens(long tokens) {
        this.toolsTokens = Math.max(0, tokens);
    }

    /** 把一条消息折算成各档占用。 */
    private Node priceMessage(String type, JsonNode message) {
        JsonNode content = message.path("content");
        if (content == null || !content.isArray()) {
            return new Node(0, 0, 0, 0);
        }

        if ("system/message".equals(type) || "developer/message".equals(type)) {
            return new Node(priceSystem(content), 0, 0, 0);
        }

        if ("tool/result".equals(type)) {
            String tool = callNames.getOrDefault(message.path("toolCallId").asText(""), "");
            boolean isFile = FILE_TOOLS.contains(tool);
            long files = 0;
            long results = 0;
            for (JsonNode block : content) {
                String kind = block.path("type").asText("");
                if ("image".equals(kind) || "file".equals(kind) || isFile) {
                    files += priceBlock(block);
                } else {
                    results += priceBlock(block);
                }
            }
            return isFile
                    ? new Node(0, files + ROLE_OVERHEAD, 0, 0)
                    : new Node(0, 0, results + ROLE_OVERHEAD, 0);
        }

        /* user / assistant：逐块归类 */
        long files = 0;
        long results = 0;
        long chat = 0;
        long system = 0;
        for (JsonNode block : content) {
            String kind = block.path("type").asText("");
            switch (kind) {
                case "image", "file" -> files += priceBlock(block);
                case "tool-call" -> {
                    String tool = callNames.getOrDefault(block.path("id").asText(""), "");
                    if (FILE_TOOLS.contains(tool)) {
                        files += priceBlock(block);
                    } else {
                        results += priceBlock(block);
                    }
                }
                case "tool-addition", "tool-removal" -> system += priceBlock(block);
                default -> chat += priceBlock(block);
            }
        }
        return new Node(system, files, results, chat);
    }

    /** 一个内容块的估算占用；公式与 DSH 的 estimateContent 一致。 */
    private long priceBlock(JsonNode block) {
        String kind = block.path("type").asText("");
        return switch (kind) {
            case "text", "reasoning" ->
                    ceilDiv(block.path("text").asText("").length(), CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
            case "tool-call" ->
                    ceilDiv(block.path("name").asText("").length(), CHARS_PER_TOKEN)
                            + ceilDiv(block.path("arguments").asText("").length(), CHARS_PER_TOKEN)
                            + BLOCK_OVERHEAD;
            default ->
                    BLOCK_OVERHEAD + ceilDiv(block.toString().length(), CHARS_PER_TOKEN);
        };
    }

    /**
     * 系统提示词的占用。
     *
     * <p>与内容块不同，系统提示词没有每块的 4 token 结构开销 ——
     * DSH 的 estimateSystemMessage 也是这么算的，要跟它对齐。</p>
     */
    private long priceSystem(JsonNode content) {
        long chars = 0;
        for (JsonNode block : content) {
            chars += "text".equals(block.path("type").asText(""))
                    ? block.path("text").asText("").length()
                    : block.toString().length();
        }
        return ceilDiv(chars, CHARS_PER_TOKEN) + ROLE_OVERHEAD;
    }

    private static long ceilDiv(long value, long divisor) {
        return (value + divisor - 1) / divisor;
    }

    /**
     * 汇总当前分档。
     *
     * @param cwd 会话工作目录，用来定位项目级 AGENTS.md；为 null 时只看全局
     * @return 分档快照
     */
    DshSdkSession.Listener.ContextBreakdown snapshot(String cwd) {
        long system = 0;
        long files = 0;
        long results = 0;
        long chat = 0;
        for (Node node : alive.values()) {
            system += node.system();
            files += node.files();
            results += node.results();
            chat += node.chat();
        }
        return new DshSdkSession.Listener.ContextBreakdown(
                system + toolsTokens,
                memoryTokens(cwd),
                files,
                results,
                chat);
    }

    /**
     * 记忆与项目规则的占用。
     *
     * <p><strong>为什么只能从磁盘估算</strong>：实测 DSH 的事件流里
     * <b>没有</b> AGENTS.md / reminders 的任何事件 —— 它们是 DSH 在组装
     * HTTP 请求时才拼进去的，SDK 层看不到。magpie 能看到是因为它工作在
     * 请求体层。我们拿不到那个形态，所以退一步：读真实文件、按同一公式估算。</p>
     *
     * <p><strong>这个数字偏小是已知的</strong>：reminders（运行期动态注入的
     * 提醒，实测一个会话里有 3000+ token）无法获取，不在这里。所以界面应当
     * 把 memory 当作「至少这么多」，而不是精确值。</p>
     *
     * <p>加载范围对齐 DSH 的 dsh-agent-instructions：全局
     * {@code ~/.dsh/AGENTS.md}，加上从项目根到 cwd 每一层的
     * AGENTS.md / CLAUDE.md 及其 .local 版本。</p>
     *
     * @param cwd 会话工作目录
     * @return 估算的 memory token
     */
    private long memoryTokens(String cwd) {
        List<Path> roots = new ArrayList<>();
        String home = System.getProperty("user.home", "");
        if (!home.isEmpty()) {
            roots.add(Path.of(home, ".dsh"));
        }

        List<Path> dirs = new ArrayList<>();
        if (cwd != null && !cwd.isBlank()) {
            Path dir = Path.of(cwd).toAbsolutePath().normalize();
            while (dir != null) {
                dirs.add(0, dir);
                if (Files.exists(dir.resolve(".git"))) {
                    break;
                }
                dir = dir.getParent();
            }
        }

        long chars = 0;
        for (Path root : roots) {
            chars += readChars(root.resolve("AGENTS.md"));
        }
        for (Path dir : dirs) {
            for (String name : List.of("AGENTS.md", "CLAUDE.md", "AGENTS.local.md", "CLAUDE.local.md")) {
                chars += readChars(dir.resolve(name));
            }
        }
        if (chars <= 0) {
            return 0;
        }
        return ceilDiv(chars, CHARS_PER_TOKEN) + ROLE_OVERHEAD;
    }

    /** 读文件字符数；不存在或读失败时算 0 —— 记忆缺失不该让整个分档失败。 */
    private static long readChars(Path path) {
        try {
            if (!Files.isRegularFile(path)) {
                return 0;
            }
            return new String(Files.readAllBytes(path), StandardCharsets.UTF_8).length();
        } catch (IOException e) {
            return 0;
        }
    }
}
