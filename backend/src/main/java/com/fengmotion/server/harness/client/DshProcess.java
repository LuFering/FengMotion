package com.fengmotion.server.harness.client;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 一个 {@code dsh --profile sdk} 子进程的 JSON-RPC 通道。
 *
 * <p>协议是换行分帧的 JSON-RPC 2.0：每行一个完整 JSON 帧，stdout 只承载协议帧，
 * stderr 只承载诊断。这里只做「发请求、读帧、分派通知」，不含任何业务判断。</p>
 *
 * <p><strong>为什么手写而不用库</strong>：协议只有三个请求方法（{@code initialize} /
 * {@code session/prompt} / {@code shutdown}）加三种通知，引入 JSON-RPC 库反而要为
 * 它的抽象付代价；官方也只提供 TypeScript 与 Python 客户端，没有 Java 版。</p>
 *
 * <p><strong>stdout 与 stderr 必须分开读</strong>：子进程的 stderr 会持续输出日志，
 * 若与 stdout 合流会破坏按行解析；若只读 stdout 不读 stderr，stderr 的管道缓冲区
 * 写满后子进程会阻塞。因此 stderr 由一个守护线程持续排空，只保留最近若干行供报错时引用。</p>
 */
public final class DshProcess {

    /** stderr 诊断尾部，由排空线程写入、由 {@link #diagnosticTail()} 读取。 */
    private final List<String> stderrTail = new java.util.ArrayList<>();

    /** 子进程句柄。 */
    private final Process process;
    /** 写 stdin 的缓冲流，用于发送请求帧。 */
    private final BufferedWriter stdin;
    /** 读 stdout 的缓冲流；由本类持有，{@link #close()} 时统一关闭。 */
    private final BufferedReader stdout;
    /** 请求 ID 计数器；JSON-RPC 要求响应能按 id 匹配请求。 */
    private final AtomicLong requestIds = new AtomicLong();

    /**
     * 构造通道并接管子进程的 stdin/stdout。
     *
     * <p><strong>三个流都由本类持有</strong>：stdin / stdout 在这里创建，stderr 在
     * {@link #drainStderr} 里创建。{@link #close()} 必须把三者都关掉——只关 stdin
     * 会让 stdout / stderr 的读端留下来，靠 GC 才回收。每轮起进程的模型下，
     * 这个延迟回收会持续累积管道文件描述符，几百轮之后 {@code posix_spawn} 就会
     * 报 EBADF（open-design 在 issue #4100 上踩过同样的坑）。</p>
     *
     * @param process 已启动的 {@code dsh} 子进程
     * @throws IOException 无法获取子进程流时抛出
     */
    public DshProcess(Process process) throws IOException {
        this.process = process;
        this.stdin = new BufferedWriter(
                new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
        this.stdout = new BufferedReader(
                new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
    }

    /** 子进程是否仍在运行。 */
    public boolean isAlive() {
        return process.isAlive();
    }

    /**
     * 分配一个新的请求 ID。
     *
     * @return 单调递增的请求 ID
     */
    public long nextRequestId() {
        return requestIds.incrementAndGet();
    }

    /**
     * 发送一个 JSON-RPC 请求帧。
     *
     * <p>写入后立即 flush：协议是交互式的，攒批会让对端一直等不到输入。</p>
     *
     * @param id     请求 ID
     * @param method 方法名
     * @param params 参数对象；没有参数时传 {@code null}
     * @throws IOException 写入失败（通常意味着子进程已退出）时抛出
     */
    public void sendRequest(long id, String method, JsonNode params) throws IOException {
        ObjectNode frame = buildFrame("2.0");
        frame.put("id", id);
        frame.put("method", method);
        if (params != null) {
            frame.set("params", params);
        }
        writeLine(frame);
    }

    /**
     * 写出一个帧并 flush。
     *
     * @param frame 已构造好的 JSON 帧
     * @throws IOException 写入失败时抛出
     */
    public void writeLine(ObjectNode frame) throws IOException {
        stdin.write(frame.toString());
        stdin.write("\n");
        stdin.flush();
    }

    /**
     * 读取下一行原始文本。
     *
     * <p>调用方负责解析与分派；返回 {@code null} 表示流已结束（子进程退出）。</p>
     *
     * @param reader 子进程 stdout 的读取器
     * @return 一行文本；流结束时为 null
     * @throws IOException 读取失败时抛出
     */
    public static String readLine(BufferedReader reader) throws IOException {
        return reader.readLine();
    }

    /**
     * 子进程 stdout 的按行读取器（由本类持有，不要另行 close）。
     *
     * @return 读取器
     */
    public BufferedReader openStdout() {
        return stdout;
    }

    /**
     * 在后台持续排空 stderr：保留最近的若干行用于诊断，并把插件帧交给回调。
     *
     * <p>不排空会让子进程因 stderr 管道写满而阻塞；保留尾部是为了子进程异常退出时
     * 能把真实的错误原因带回给调用方，而不是只说「进程退出了」。</p>
     *
     * <p><strong>为什么流式帧走 stderr</strong>：stdout 是 SDK server 的协议通道，
     * 插件往那里写实测收不到（写入时序被 SDK 独占）。stderr 是双方共用的诊断通道，
     * 插件把每帧写成一行 JSON，这里按「以 { 开头且带 method」筛选，
     * 与 DSH 自己的 {@code dsh: reasoning:} 等文本诊断天然可区分。</p>
     *
     * @param keepLines 保留的行数上限
     * @param onStreamFrame 收到插件流式帧时的回调；可为 null
     * @return 读取 stderr 的守护线程（已启动）
     */
    public Thread drainStderr(int keepLines, java.util.function.Consumer<JsonNode> onStreamFrame) {
        Thread thread = new Thread(() -> {
            List<String> tail = stderrTail;
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    JsonNode frame = asStreamFrame(line);
                    if (frame != null && onStreamFrame != null) {
                        onStreamFrame.accept(frame);
                        continue;
                    }
                    synchronized (tail) {
                        tail.add(line);
                        while (tail.size() > keepLines) {
                            tail.remove(0);
                        }
                    }
                }
            } catch (IOException ignored) {
                // 子进程退出时流会关闭，这是正常结束路径，不需要上报。
            }
        }, "dsh-stderr-drain");
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    /**
     * 最近读到的 stderr 诊断尾部。
     *
     * <p>由 {@link #drainStderr} 的守护线程维护，报错时用来还原真实原因。
     * 目前仅用于诊断输出；保留成可读状态而不是只写日志，方便失败帧里带出上下文。</p>
     *
     * @return 最近的诊断行（副本）
     */
    public List<String> diagnosticTail() {
        synchronized (stderrTail) {
            return List.copyOf(stderrTail);
        }
    }

    /**
     * 把一行 stderr 文本识别为插件流式帧。
     *
     * <p>只认「合法 JSON 且带 {@code method} 字段」的行：DSH 的诊断文本不是 JSON，
     * 而普通 JSON 诊断（若将来出现）没有 {@code method}，都不会被误判。</p>
     *
     * @param line 一行 stderr
     * @return 识别为帧时返回解析结果，否则为 null
     */
    /**
     * 测试可见的识别入口：把一行 stderr 文本解析为插件帧。
     *
     * <p>生产代码通过 {@link #drainStderr} 间接调用；单独暴露是为了让单元测试
     * 能覆盖「诊断文本 / 畸形 JSON / 合法帧」三种输入的边界。</p>
     *
     * @param line 一行 stderr
     * @return 识别为帧时返回解析结果，否则为 null
     */
    static JsonNode asStreamFrameForTest(String line) {
        return asStreamFrame(line);
    }

    private static JsonNode asStreamFrame(String line) {
        String trimmed = line.trim();
        if (trimmed.isEmpty() || trimmed.charAt(0) != '{') {
            return null;
        }
        try {
            JsonNode node = MAPPER.readTree(trimmed);
            return node.hasNonNull("method") ? node : null;
        } catch (IOException malformed) {
            return null;
        }
    }

    /**
     * 关闭 stdin 并终止子进程，最后关掉 stdout / stderr 的读端。
     *
     * <p>先关 stdin 让子进程有机会自行退出，再 {@code destroy()}；两条都不成就
     * {@code destroyForcibly()}。这是官方客户端 {@code close()} 用的同一套阶梯。</p>
     *
     * <p><strong>关闭顺序有讲究</strong>：stdout / stderr 必须在进程终止之后关。
     * 若先关读端，排空线程会立刻读到 EOF 退出，而子进程还在往管道里写，
     * 结果是子进程收到 SIGPIPE / EPIPE 而不是走正常退出阶梯——错误信息就丢了。
     * 放在最后关也不是「顺手」，是为了把管道 FD 交还给系统：这个模型每轮都起新进程，
     * 靠 GC 回收会积压 FD。</p>
     */
    public void close() {
        try {
            stdin.close();
        } catch (IOException ignored) {
            // stdin 可能已随子进程退出而关闭，忽略即可。
        }
        if (process.isAlive()) {
            process.destroy();
        }
        try {
            if (!process.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)) {
                process.destroyForcibly();
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
        }
        closeQuietly(stdout);
        closeQuietly(process.getErrorStream());
        closeQuietly(process.getInputStream());
        closeQuietly(process.getOutputStream());
    }

    /**
     * 关闭一个流并吞掉异常。
     *
     * <p>关流失败没有补救手段，也不影响下一轮（下一轮是新进程、新管道），
     * 因此不向上抛，避免把「清理失败」升级成「这一轮失败」。</p>
     *
     * @param closeable 待关闭的对象；为 null 时直接返回
     */
    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (IOException ignored) {
            // 见方法注释：清理阶段的异常不改变本轮结果。
        }
    }

    /** 构造一个空的 JSON-RPC 帧。 */
    private static ObjectNode buildFrame(String jsonrpc) {
        ObjectNode frame = MAPPER.createObjectNode();
        frame.put("jsonrpc", jsonrpc);
        return frame;
    }

    /** 帧构造共用的 ObjectMapper；线程安全，可复用。 */
    private static final ObjectMapper MAPPER = new ObjectMapper();
}
