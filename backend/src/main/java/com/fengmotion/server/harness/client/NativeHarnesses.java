package com.fengmotion.server.harness.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.harness.config.HarnessProperties;
import com.fengmotion.server.harness.domain.HarnessCapabilities;
import com.fengmotion.server.harness.domain.HarnessDescriptor;
import com.fengmotion.server.harness.service.HarnessService.ModelEntry;
import org.springframework.stereotype.Component;
import lombok.RequiredArgsConstructor;
import java.io.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Local CLI discovery and protocol adapters. No credentials leave the CLI process. */
@Component
@RequiredArgsConstructor
public class NativeHarnesses {
    private final ObjectMapper json;
    private final HarnessProperties properties;
    private final Map<String, Probe> cache = new ConcurrentHashMap<>();
    public record Selection(String harness, String model, String reasoningEffort) {
        public boolean nativeEngine() { return "codex".equals(harness) || "claude".equals(harness); }
    }
    public record Probe(HarnessDescriptor descriptor, List<ModelEntry> models, Instant at) { }
    public static boolean supports(String id) { return "codex".equals(id) || "claude".equals(id); }
    public synchronized Probe probe(String id) {
        if (!properties.isEnabled()) return result(id, HarnessDescriptor.Status.UNAVAILABLE, "引擎接入已关闭", List.of());
        Probe old = cache.get(id);
        if (old != null && old.at().plusMillis(properties.getProbeCacheMs()).isAfter(Instant.now())) return old;
        Probe value;
        try (Channel ch = open(id, Path.of(System.getProperty("java.io.tmpdir")))) {
            List<ModelEntry> models = new ArrayList<>();
            long until = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(Math.max(500, properties.getProbeTimeoutMs()));
            if (id.equals("codex")) {
                ch.codexInit(until);
                String cursor = null;
                do {
                    ObjectNode params = json.createObjectNode();
                    if (cursor != null) params.put("cursor", cursor);
                    JsonNode response = ch.rpc("model/list", params, until).path("result");
                    for (JsonNode m : response.path("data")) if (!m.path("hidden").asBoolean()) {
                        List<String> efforts = new ArrayList<>();
                        for (JsonNode e : m.path("supportedReasoningEfforts")) efforts.add(e.path("reasoningEffort").asText());
                        models.add(new ModelEntry(m.path("id").asText(), m.path("displayName").asText(m.path("id").asText()),
                                m.path("isDefault").asBoolean(), null, null, efforts));
                    }
                    cursor = response.path("nextCursor").isTextual() ? response.path("nextCursor").asText() : null;
                    if (models.size() > 2000) throw new IOException("模型目录过大");
                } while (cursor != null && !cursor.isBlank());
            } else {
                JsonNode data = ch.claudeInit(until);
                for (JsonNode m : data.path("models")) {
                    List<String> efforts = new ArrayList<>();
                    for (JsonNode e : m.path("supportedEffortLevels")) efforts.add(e.asText());
                    String label = m.path("resolvedModel").asText(m.path("displayName").asText(m.path("value").asText()));
                    models.add(new ModelEntry(m.path("value").asText(), label, "default".equals(m.path("value").asText()), null, null, efforts));
                }
            }
            value = result(id, models.isEmpty() ? HarnessDescriptor.Status.MISCONFIGURED : HarnessDescriptor.Status.AVAILABLE,
                    models.isEmpty() ? "程序已找到，但未能读取可用模型，请检查本机引擎配置" : "已载入本机配置，连接与登录将在实际请求时验证", models);
        } catch (Exception ex) {
            value = result(id, HarnessDescriptor.Status.UNAVAILABLE, "无法载入本机引擎：" + ex.getMessage(), List.of());
        }
        cache.put(id, value);
        return value;
    }
    public void refresh() { cache.clear(); }
    private Probe result(String id, HarnessDescriptor.Status status, String note, List<ModelEntry> models) {
        return new Probe(new HarnessDescriptor(id, id.equals("codex") ? "Codex" : "Claude Code", "headless", status,
                null, note, new HarnessCapabilities(HarnessCapabilities.Streaming.TOKEN, HarnessCapabilities.Cancel.PROCESS,
                false, true, false)), List.copyOf(models), Instant.now());
    }
    public void validate(Selection s) {
        if (s == null || !supports(s.harness())) throw new IllegalArgumentException("未知引擎");
        Probe p = probe(s.harness());
        if (p.descriptor().status() != HarnessDescriptor.Status.AVAILABLE) throw new IllegalArgumentException(p.descriptor().note());
        if (s.model() != null && p.models().stream().noneMatch(m -> m.id().equals(s.model()))) throw new IllegalArgumentException("模型不在所选引擎的目录中");
        if (s.reasoningEffort() != null && !List.of("low", "medium", "high", "xhigh", "max", "ultra").contains(s.reasoningEffort())) throw new IllegalArgumentException("无效的推理强度");
    }
    public static String effort(Selection s, List<ModelEntry> models) {
        if (s.reasoningEffort() == null) return null;
        List<String> supported = models.stream().filter(m -> m.id().equals(s.model()) || (s.model() == null && m.isDefault()))
                .findFirst().map(ModelEntry::reasoningEfforts).orElse(List.of());
        List<String> levels = List.of("low", "medium", "high", "xhigh", "max", "ultra");
        for (int i = levels.indexOf(s.reasoningEffort()); i >= 0; i--) if (supported.contains(levels.get(i))) return levels.get(i);
        return supported.isEmpty() ? null : supported.getFirst();
    }
    public String run(Selection s, Path cwd, String prompt, List<DshSdkSession.InlineImage> images,
                      DshSdkSession.Listener listener, Duration budget, Consumer<DshProcess> registered) throws IOException {
        validate(s);
        try (Channel ch = open(s.harness(), cwd, s)) {
            registered.accept(ch.process);
            long until = System.nanoTime() + budget.toNanos();
            ch.heartbeat = listener::onHeartbeat;
            listener.onTurnStarted(1);
            String selectedEffort = effort(s, probe(s.harness()).models());
            String answer;
            if (s.harness().equals("codex")) {
                ch.codexInit(until);
                ObjectNode params = json.createObjectNode().put("cwd", cwd.toString()).put("approvalPolicy", "never").put("sandbox", "workspace-write");
                if (s.model() != null) params.put("model", s.model());
                String thread = ch.rpc("thread/start", params, until).path("result").path("thread").path("id").asText();
                if (thread.isBlank()) throw new IOException("Codex 未返回会话身份");
                ObjectNode turn = json.createObjectNode().put("threadId", thread);
                var input = turn.putArray("input");
                input.addObject().put("type", "text").put("text", prompt);
                for (var image : images) input.addObject().put("type", "image").put("url", "data:" + image.mimeType() + ";base64," + image.base64());
                if (selectedEffort != null) turn.put("effort", selectedEffort);
                ch.send(json.createObjectNode().put("id", ++ch.seq).put("method", "turn/start").set("params", turn));
                Map<String, String> texts = new LinkedHashMap<>();
                while (true) {
                    JsonNode frame = ch.next(until);
                    if (frame.has("error")) throw new IOException(frame.path("error").path("message").asText("Codex 请求失败"));
                    String method = frame.path("method").asText(); JsonNode p = frame.path("params");
                    if (method.equals("item/agentMessage/delta")) listener.onTextDelta(p.path("delta").asText());
                    if (method.equals("error")) listener.onDiagnostic("retry", p.path("error").path("message").asText("Codex 正在处理连接错误"));
                    if (method.equals("item/started") || method.equals("item/completed")) {
                        JsonNode item = p.path("item"); String type = item.path("type").asText(); String itemId = item.path("id").asText();
                        if (type.equals("agentMessage") && method.equals("item/completed")) texts.put(itemId, item.path("text").asText());
                        else if (List.of("commandExecution", "fileChange", "mcpToolCall", "webSearch").contains(type)) {
                            if (method.equals("item/started")) listener.onToolCall(itemId, type, item.has("command") ? item.path("command").asText() : "");
                            else listener.onToolResult(itemId, item.path("aggregatedOutput").asText(), "failed".equals(item.path("status").asText()));
                        }
                    }
                    if (method.equals("turn/completed")) {
                        String status = p.path("turn").path("status").asText();
                        if (!status.equals("completed")) throw new IOException(p.path("turn").path("error").path("message").asText("Codex 任务未完成：" + status));
                        break;
                    }
                    if (frame.has("id") && frame.has("method")) ch.send(json.createObjectNode().<ObjectNode>set("id", frame.get("id")).set("error", json.createObjectNode().put("code", -32601).put("message", "此入口尚不支持交互批准")));
                }
                answer = String.join("\n\n", texts.values());
            } else {
                ch.claudeInit(until);
                ObjectNode user = json.createObjectNode().put("type", "user").put("session_id", "");
                user.putNull("parent_tool_use_id");
                var content = user.putObject("message").put("role", "user").putArray("content");
                content.addObject().put("type", "text").put("text", prompt);
                for (var image : images) content.addObject().put("type", "image").putObject("source").put("type", "base64").put("media_type", image.mimeType()).put("data", image.base64());
                ch.send(user);
                StringBuilder full = new StringBuilder();
                while (true) {
                    JsonNode frame = ch.next(until); String type = frame.path("type").asText();
                    if (type.equals("stream_event")) {
                        JsonNode event = frame.path("event");
                        if (event.path("type").asText().equals("content_block_delta") && event.path("delta").path("type").asText().equals("text_delta")) listener.onTextDelta(event.path("delta").path("text").asText());
                    }
                    if (type.equals("assistant")) for (JsonNode block : frame.path("message").path("content")) {
                        if (block.path("type").asText().equals("text")) full.append(block.path("text").asText()).append('\n');
                        if (block.path("type").asText().equals("tool_use")) listener.onToolCall(block.path("id").asText(), block.path("name").asText(), block.path("input").toString());
                    }
                    if (type.equals("user")) for (JsonNode block : frame.path("message").path("content")) if (block.path("type").asText().equals("tool_result")) listener.onToolResult(block.path("tool_use_id").asText(), block.path("content").asText(), block.path("is_error").asBoolean());
                    if (type.equals("control_request")) ch.send(json.createObjectNode().put("type", "control_response").set("response", json.createObjectNode().put("subtype", "success").put("request_id", frame.path("request_id").asText()).set("response", json.createObjectNode().put("behavior", "deny").put("message", "需要用户在本机引擎配置中批准此操作"))));
                    if (type.equals("system") && frame.path("subtype").asText().equals("api_retry")) {
                        listener.onDiagnostic("retry", "本机引擎正在重试模型请求，请检查其连接和模型配置。");
                    }
                    if (type.equals("result")) {
                        if (!frame.path("permission_denials").isMissingNode() && !frame.path("permission_denials").isEmpty()) {
                            listener.onDiagnostic("permissions", "部分操作被本机引擎权限拒绝，请核对回复与工程结果。");
                        }
                        if (frame.path("is_error").asBoolean()) throw new IOException(frame.path("result").asText(frame.path("errors").toString()));
                        // Include public phase messages, followed by the final response (no duplicated final block).
                        answer = full.toString().strip();
                        if (answer.isBlank()) answer = frame.path("result").asText();
                        break;
                    }
                }
            }
            if (answer.isBlank()) throw new IOException("引擎结束但没有返回回复");
            listener.onTurnEnded(false, null);
            return answer;
        }
    }
    private Channel open(String id, Path cwd) throws IOException { return open(id, cwd, null); }
    private Channel open(String id, Path cwd, Selection selection) throws IOException {
        List<String> command = new ArrayList<>(command(id));
        if (id.equals("codex")) command.add("app-server");
        else Collections.addAll(command, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", "acceptEdits");
        if (id.equals("claude") && selection != null) {
            if (selection.model() != null) Collections.addAll(command, "--model", selection.model());
            String effort = effort(selection, probe(id).models());
            if (effort != null) Collections.addAll(command, "--effort", effort);
        }
        ProcessBuilder builder = new ProcessBuilder(command).directory(cwd.toFile());
        builder.environment().remove("ELECTRON_RUN_AS_NODE");
        return new Channel(builder.start());
    }
    List<String> command(String id) throws IOException {
        String configured = id.equals("codex") ? properties.getCodexBin() : properties.getClaudeBin();
        if (configured != null && !configured.isBlank()) return List.of(configured);
        if (id.equals("codex")) {
            String runtime = System.getenv("CODEX_APP_RUNTIME_CLI_PATH");
            if (runtime != null && Files.isExecutable(Path.of(runtime))) return List.of(runtime);
            Path home = Path.of(System.getProperty("user.home"));
            for (Path candidate : List.of(Path.of("/usr/lib/chatgpt/resources/codex"),
                    Path.of("/Applications/Codex.app/Contents/Resources/codex"), home.resolve(".local/share/codex/codex"))) {
                if (Files.isExecutable(candidate)) return List.of(candidate.toString());
            }
        }
        List<Path> dirs = new ArrayList<>();
        for (String dir : System.getenv().getOrDefault("PATH", "").split(java.util.regex.Pattern.quote(File.pathSeparator))) if (!dir.isBlank()) dirs.add(Path.of(dir));
        Path home = Path.of(System.getProperty("user.home"));
        for (String relative : List.of(".local/bin", ".npm-global/bin", ".cargo/bin", "AppData/Roaming/npm")) dirs.add(home.resolve(relative));
        String bin = id.equals("codex") ? "codex" : "claude";
        for (Path dir : dirs) {
            Path file = dir.resolve(bin);
            if (!Files.isExecutable(file)) continue;
            // Common ACP packaging installs a wrapper named codex. Use its bundled genuine CLI.
            if (id.equals("codex")) {
                Path real = file.toRealPath();
                for (Path parent = real.getParent(); parent != null; parent = parent.getParent()) {
                    Path nested = parent.resolve("node_modules/@openai/codex/bin/codex.js");
                    if (Files.isRegularFile(nested)) return List.of("node", nested.toString());
                    if (parent.equals(home)) break;
                }
            }
            return List.of(file.toString());
        }
        throw new IOException("找不到 " + bin + "，请先安装或配置可执行文件路径");
    }
    private final class Channel implements AutoCloseable {
        final DshProcess process;
        final BlockingQueue<JsonNode> frames = new LinkedBlockingQueue<>(2048);
        volatile boolean eof;
        final Thread reader;
        long seq = 0;
        long lastHeartbeat = System.nanoTime();
        Runnable heartbeat = () -> { };
        Channel(Process raw) throws IOException {
            process = new DshProcess(raw, true); process.drainStderr(8, null);
            reader = Thread.ofVirtual().start(() -> {
                try { String line; while ((line = process.openStdout().readLine()) != null) { try { JsonNode frame = json.readTree(line); if (frame != null) frames.put(frame); } catch (InterruptedException ex) { Thread.currentThread().interrupt(); break; } catch (IOException ignored) { } } }
                catch (IOException ignored) { } finally { eof = true; }
            });
        }
        void send(JsonNode frame) throws IOException { process.writeLine((ObjectNode)frame); }
        JsonNode next(long until) throws IOException {
            try {
                while (System.nanoTime() < until) {
                    JsonNode frame = frames.poll(100, TimeUnit.MILLISECONDS);
                    if (System.nanoTime() - lastHeartbeat > TimeUnit.SECONDS.toNanos(10)) {
                        lastHeartbeat = System.nanoTime(); heartbeat.run();
                    }
                    if (frame != null) return frame;
                    if (eof) throw new IOException("引擎进程已退出，请检查登录、模型与权限配置");
                }
                throw new IOException("引擎响应超时");
            } catch (InterruptedException ex) { Thread.currentThread().interrupt(); throw new IOException("操作中断", ex); }
        }
        JsonNode rpc(String method, JsonNode params, long until) throws IOException {
            long id = ++seq; send(json.createObjectNode().put("id", id).put("method", method).set("params", params));
            while (true) { JsonNode f = next(until); if (f.path("id").asLong(-1) == id) { if (f.has("error")) throw new IOException(f.path("error").path("message").asText()); return f; } }
        }
        void codexInit(long until) throws IOException {
            rpc("initialize", json.createObjectNode().set("clientInfo", json.createObjectNode().put("name", "fengmotion").put("version", "0.1.1")), until);
            send(json.createObjectNode().put("method", "initialized"));
        }
        void control(String subtype, ObjectNode data) throws IOException {
            data.put("subtype", subtype);
            send(json.createObjectNode().put("type", "control_request").put("request_id", Long.toString(++seq)).set("request", data));
        }
        JsonNode claudeInit(long until) throws IOException {
            control("initialize", json.createObjectNode());
            while (true) { JsonNode f = next(until); if (f.path("type").asText().equals("control_response")) { if (!f.path("response").path("subtype").asText().equals("success")) throw new IOException("Claude Code 初始化失败"); return f.path("response").path("response"); } }
        }
        @Override public void close() { process.close(); reader.interrupt(); }
    }
}
