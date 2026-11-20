package com.fengmotion.server.chat.service;

import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.chat.domain.ChatMessage;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatMessageRepository;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.harness.client.DshLauncher;
import com.fengmotion.server.harness.client.DshNarration;
import com.fengmotion.server.harness.client.DshProcess;
import com.fengmotion.server.harness.client.DshSdkSession;
import com.fengmotion.server.harness.config.HarnessProperties;
import com.fengmotion.server.harness.service.HarnessService;

@Service
public class ChatStreamService {

    private static final org.slf4j.Logger LOG =
            org.slf4j.LoggerFactory.getLogger(ChatStreamService.class);

    private final HarnessService harness;
    private final com.fengmotion.server.harness.client.NativeHarnesses nativeHarnesses;
    private final com.fengmotion.server.upload.service.UploadService uploads;
    private final com.fengmotion.server.project.store.ProjectRepository projects;
    private final HarnessProperties properties;
    private final DshLauncher launcher;
    private final ChatSessionRepository sessions;
    private final ChatMessageRepository messages;
    private final ChatReplyStore replyStore;
    private final ChatSseWriter sse;
    private final ObjectMapper json;

    private final com.fengmotion.server.creation.service.ChatTurnRender turnRender;

    private final ThreadLocal<Runnable> currentFlush = new ThreadLocal<>();

    public ChatStreamService(HarnessService harness,
                             com.fengmotion.server.harness.client.NativeHarnesses nativeHarnesses,
                             com.fengmotion.server.upload.service.UploadService uploads,
                             com.fengmotion.server.project.store.ProjectRepository projects,
                             HarnessProperties properties, DshLauncher launcher,
                             ChatSessionRepository sessions, ChatMessageRepository messages,
                             TransactionTemplate transactions, ObjectMapper json,
                             com.fengmotion.server.creation.service.ChatTurnRender turnRender) {
        this.harness = harness;
        this.nativeHarnesses = nativeHarnesses;
        this.uploads = uploads;
        this.projects = projects;
        this.properties = properties;
        this.launcher = launcher;
        this.sessions = sessions;
        this.messages = messages;
        this.json = json;
        this.turnRender = turnRender;
        this.replyStore = new ChatReplyStore(messages, sessions, transactions);
        this.sse = new ChatSseWriter(json, currentFlush::get);
    }

    ChatReplyListener replyListener(PrintWriter out, String sessionId, boolean ordered) {
        return new ChatReplyListener(out, ordered, json, sse, title -> sessions.updateTitle(sessionId, title));
    }

    public static final String SESSION_BUSY_MESSAGE = "上一轮回复还在执行，结束后可在消息记录里查看结果；要中止请点停止。";

    private final java.util.Map<String, DshProcess> runningTurns =
            new java.util.concurrent.ConcurrentHashMap<>();

    private final java.util.Map<String, Long> stoppedTurns =
            new java.util.concurrent.ConcurrentHashMap<>();

    private static final long STOP_MARK_TTL_MS = 60_000L;

    public boolean isAvailable(String id) { return harness.isAvailable(id); }

    public boolean isAvailable() {
        return harness.isAvailable();
    }

    static final List<String> EFFORT_LEVELS = List.of("low", "medium", "high", "max", "ultra");

    public void validateSelection(String id, String model, String reasoningEffort) {
        if (com.fengmotion.server.harness.client.NativeHarnesses.supports(id)) {
            try { nativeHarnesses.validate(new com.fengmotion.server.harness.client.NativeHarnesses.Selection(id, model, reasoningEffort)); }
            catch (IllegalArgumentException ex) { throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", ex.getMessage()); }
        } else if (id == null || id.isBlank() || id.equals("deepseek") || id.equals(HarnessService.DSH_ID)) validateSelection(model, reasoningEffort);
        else throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "未知引擎");
    }

    public void validateSelection(String model, String reasoningEffort) {
        if (model != null && (model.isBlank() || model.length() > 256
                || harness.listModels(HarnessService.DSH_ID).stream().noneMatch(entry -> entry.id().equals(model)))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "模型不在当前引擎的可选目录中");
        }
        if (reasoningEffort != null && !EFFORT_LEVELS.contains(reasoningEffort)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "推理强度无效");
        }
    }

    String resolveEffort(String model, String requested) {
        if (requested == null || !EFFORT_LEVELS.contains(requested)) {
            return null;
        }
        String effectiveModel = model == null || model.isBlank() ? properties.getModel() : model;
        List<String> supported = harness.listModels(HarnessService.DSH_ID).stream()
                .filter(entry -> entry.id().equals(effectiveModel))
                .findFirst()
                .map(HarnessService.ModelEntry::reasoningEfforts)
                .orElse(null);
        if (supported == null) {
            return requested;
        }
        for (int level = EFFORT_LEVELS.indexOf(requested); level >= 0; level--) {
            if (supported.contains(EFFORT_LEVELS.get(level))) {
                return EFFORT_LEVELS.get(level);
            }
        }
        // 连比它更低的档位都没有（例如模型只支持 high）：用它最低的那一档，
        // 而不是丢掉选择让引擎自己猜 —— 那样界面显示与实际生效会对不上。
        for (String level : EFFORT_LEVELS) {
            if (supported.contains(level)) {
                return level;
            }
        }
        return null;
    }

    private Duration turnBudget() {
        return TURN_SAFETY_CAP;
    }

    private static final Duration TURN_SAFETY_CAP = Duration.ofHours(6);

    public boolean stop(String sessionId) {
        DshProcess process = runningTurns.get(sessionId);
        if (process == null) {
            // 没有在跑的轮次：不是错误，前端不该因此弹错。常见于
            // 「点停止」与「这轮刚好自己结束」撞在一起。
            cleanupStopMark(sessionId);
            return false;
        }
        stoppedTurns.put(sessionId, System.currentTimeMillis());
        LOG.info("stop requested: session={} alive={}", sessionId, process.isAlive());
        process.close();
        return true;
    }

    private boolean wasStopped(String sessionId) {
        Long at = stoppedTurns.get(sessionId);
        if (at == null) {
            return false;
        }
        if (System.currentTimeMillis() - at > STOP_MARK_TTL_MS) {
            cleanupStopMark(sessionId);
            return false;
        }
        return true;
    }

    private void cleanupStopMark(String sessionId) {
        stoppedTurns.remove(sessionId);
    }

    public void stream(String sessionId, PrintWriter writer, String userText, Runnable flush) {
        stream(sessionId, writer, userText, null, flush);
    }

    public void stream(String sessionId, PrintWriter writer, String userText,
                       com.fasterxml.jackson.databind.JsonNode attachments, Runnable flush) {
        stream(sessionId, writer, userText, attachments, null, null, flush);
    }

    public void stream(String sessionId, PrintWriter writer, String userText,
                       JsonNode attachments, String model, String reasoningEffort, Runnable flush) {
        currentFlush.set(flush);
        try {
            doStream(sessionId, writer, userText, attachments, model, reasoningEffort);
        } finally {
            currentFlush.remove();
        }
    }

    public void stream(String sessionId, PrintWriter writer, String text, JsonNode attachments,
                       String engine, String model, String effort, Runnable flush) {
        if (!com.fengmotion.server.harness.client.NativeHarnesses.supports(engine)) {
            stream(sessionId, writer, text, attachments, model, effort, flush); return;
        }
        currentFlush.set(flush);
        DshProcess[] active = {null};
        try {
            ChatSession session = sessions.findById(sessionId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "会话不存在"));
            StringBuilder history = new StringBuilder(conversationHistory(sessionId));
            history.append("本轮要求：\n").append(text).append("\n开始或切换主要方向前先简短说明接下来做什么，不要披露内部推理。");
            ChatReplyListener listener = replyListener(writer, sessionId, false);
            String renderBefore = turnRender == null ? null : turnRender.before(session.projectId(), projectRootFor(session));
            String reply = nativeHarnesses.run(new com.fengmotion.server.harness.client.NativeHarnesses.Selection(engine, model, effort),
                    java.nio.file.Path.of(workingDirectoryFor(session)), history.toString(), inlineImages(attachments), listener, turnBudget(), process -> {
                        active[0] = process;
                        if (runningTurns.putIfAbsent(sessionId, process) != null) throw new IllegalStateException("该会话已有正在执行的回复");
                        cleanupStopMark(sessionId);
                    });
            if (wasStopped(sessionId)) sse.writeStopped(writer);
            else {
                var saved = replyStore.append(sessionId, reply, null, listener.collectedToolCalls(), listener.collectedTodos(), listener.collectedUsage(), listener.collectedDeliverables(), null);
                sessions.bindHarnessSession(sessionId, "external:" + engine);
                listener.emitPhase("done", null, null); sse.writeCompleted(writer, saved);
                renderAfterTurn(session, renderBefore, text, writer);
            }
        } catch (Exception ex) {
            if (wasStopped(sessionId)) sse.writeStopped(writer);
            else sse.writeError(writer, "agent_error", ex.getMessage() == null ? "引擎执行失败" : ex.getMessage());
        } finally {
            if (active[0] != null) runningTurns.remove(sessionId, active[0]);
            sse.writeEnd(writer); currentFlush.remove();
        }
    }

    private String conversationHistory(String sessionId) {
        StringBuilder history = new StringBuilder("以下是此会话历史，仅作上下文；请回答最后的本轮要求。\n");
        long cursor = 0;
        while (true) {
            var page = messages.findAfterSeq(sessionId, cursor, 200);
            if (page.isEmpty()) break;
            for (ChatMessage m : page) {
                cursor = m.seq();
                history.append(m.role()).append(": ").append(m.text()).append("\n\n");
            }
        }
        return history.toString();
    }

    void saveUnfinished(String sessionId, ChatReplyListener listener, String reasoning, String reason, PrintWriter out) {
        if (listener == null || listener.publicText == null) return;
        String text = listener.publicText.text();
        var tools = listener.collectedToolCalls();
        if ((text == null || text.isBlank()) && tools.isEmpty()) return;
        String body = (text == null || text.isBlank() ? "" : text + "\n\n") + "> 这一轮没有完成：" + reason;
        ChatMessage saved = replyStore.append(sessionId, body, reasoning, tools, listener.collectedTodos(),
                listener.collectedUsage(), listener.collectedDeliverables(), listener.collectedReasoningSegments());
        sse.writeCompleted(out, saved);
    }

    private java.nio.file.Path projectRootFor(ChatSession session) {
        String projectId = session.projectId();
        if (projectId == null || projectId.isBlank()) return null;
        return projects.findById(projectId).map(project -> project.rootPath())
                .filter(root -> root != null && !root.isBlank())
                .map(root -> java.nio.file.Path.of(root).toAbsolutePath().normalize())
                .orElse(null);
    }

    void renderAfterTurn(ChatSession session, String before, String prompt, PrintWriter out) {
        if (turnRender == null || before == null) return;
        java.nio.file.Path root = projectRootFor(session);
        if (root == null) return;
        Runnable flush = currentFlush.get();
        var ticker = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "chat-render-heartbeat");
            thread.setDaemon(true);
            return thread;
        });
        try {
            var result = turnRender.renderIfChanged(session.projectId(), root, before, prompt, () -> {
                writeRender(out, "rendering", null, null, "正在渲染这一轮的改动…");
                ticker.scheduleAtFixedRate(() -> {
                    currentFlush.set(flush);
                    sse.writeFrame(out, "heartbeat", json.createObjectNode().put("type", "heartbeat"));
                }, renderHeartbeatMillis, renderHeartbeatMillis, java.util.concurrent.TimeUnit.MILLISECONDS);
            });
            stopTicker(ticker);
            result.ifPresent(r -> writeRender(out, r.state(), r.version(), r.artifactPath(), r.message()));
        } finally {
            stopTicker(ticker);
        }
    }

    private static void stopTicker(java.util.concurrent.ScheduledExecutorService ticker) {
        ticker.shutdownNow();
        try {
            ticker.awaitTermination(2, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    long renderHeartbeatMillis = 15_000;

    private void writeRender(PrintWriter out, String state, Long version, String artifactPath, String message) {
        ObjectNode data = json.createObjectNode();
        data.put("type", "render");
        data.put("state", state);
        if (version != null) data.put("version", version);
        if (artifactPath != null) data.put("artifactPath", artifactPath);
        if (message != null) data.put("message", message);
        sse.writeFrame(out, "render", data);
    }

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
                          JsonNode attachments, String model, String reasoningEffort) {
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
        boolean importHistory = session.harnessSessionId() != null && session.harnessSessionId().startsWith("external:");
        boolean continuation = session.harnessSessionId() != null
                && !session.harnessSessionId().isBlank() && !importHistory;
        String harnessSessionId = continuation
                ? session.harnessSessionId()
                : "fm-" + sessionId + (importHistory ? "-" + UUID.randomUUID() : "");

        DshProcess process = null;
        AtomicBoolean finished = new AtomicBoolean(false);
        // 进程或协议中途失败时也要把已经说的、做的存下来，所以提到 try 外面
        ChatReplyListener listener = null;
        String renderBefore = null;
        // 分段计时：回答「每轮的进程启动到底占多少」这个问题。
        // 只有分得清 spawn / resume / 首 token / 总时长，才能判断要不要上常驻进程；
        // 当前决定是按 A 方案（每轮一个进程），这组数据用来验证该决定是否成立。
        ChatTurnTiming timing = new ChatTurnTiming();
        try {
            process = launcher.startSdk();
            timing.markSpawned();

            if (runningTurns.putIfAbsent(sessionId, process) != null) {
                sse.writeError(writer, "session_busy", SESSION_BUSY_MESSAGE);
                sse.writeEnd(writer);
                finished.set(true);
                return;
            }
            // 新一轮开始即清掉上一轮的停止标记，避免旧的「已停止」污染本轮的失败判断。
            cleanupStopMark(sessionId);

            DshSdkSession driver = new DshSdkSession(
                    process, json, properties.getProvider(),
                    model == null ? properties.getModel() : model, resolveEffort(model, reasoningEffort));
            // stderr 必须在 driver 之后开始排空：插件把 token 级帧写在这里，
            // 需要直接灌进 driver 的队列，读到的帧才不会被当成诊断日志丢掉。
            process.drainStderr(200, frame -> {
                timing.markFirstDeltaIfText(frame);
                driver.acceptStreamFrame(frame);
            });

            String workingDirectory = workingDirectoryFor(session);
            // 这一轮之后要判断工程改没改，好决定是否自动出片
            renderBefore = turnRender == null ? null : turnRender.before(session.projectId(), projectRootFor(session));
            driver.initialize(workingDirectory, Duration.ofSeconds(10));
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
            listener = replyListener(out, sessionId, true);
            List<DshSdkSession.InlineImage> images = inlineImages(attachments);
            LOG.info("prompt images: attachmentsPresent={} resolved={}",
                    attachments != null, images.size());
            DshSdkSession.Outcome outcome = driver.prompt(
                    harnessSessionId,
                    (importHistory ? conversationHistory(sessionId) + "\n本轮要求：\n" : "") + userText + DshNarration.inlineFallback(java.nio.file.Path.of(workingDirectory)),
                    images,
                    listener,
                    turnBudget());

            if (outcome.failed()) {
                // 失败：发错误帧，不落库、不发 completed。前端据此显示失败而不是「已完成」。
                // 但「用户主动停止」不是失败 —— 用 stopped 帧区分，否则界面会
                // 报「Agent 执行失败」，用户还以为是自己把引擎弄坏了。
                if (wasStopped(sessionId)) {
                    sse.writeStopped(out);
                } else {
                    String reason = outcome.failure() == null ? "Agent 执行失败" : outcome.failure();
                    saveUnfinished(sessionId, listener, outcome.reasoning(), reason, out);
                    renderAfterTurn(session, renderBefore, userText, out);
                    sse.writeError(out, "agent_error", reason);
                }
                sse.writeEnd(out);
            } else {
                // 成功：先把助手消息落库，再发 completed。顺序很重要——先落库保证
                // 前端拿到 completed 时，历史接口一定已经能读到这条消息。
                ChatMessage saved = replyStore.append(
                        sessionId, listener.publicText.text(), outcome.reasoning(),
                        listener.collectedToolCalls(), listener.collectedTodos(),
                        listener.collectedUsage(), listener.collectedDeliverables(),
                        listener.collectedReasoningSegments());
                // 先发 done 表达「本回合结束」，再发 completed 携带正文。
                // 前端契约里 done 是收尾 phase，缺了它界面会停在「正在思考」。
                listener.emitPhase("done", null, null);
                sse.writeCompleted(out, saved);
                renderAfterTurn(session, renderBefore, userText, out);
                sse.writeEnd(out);
            }
            finished.set(true);
        } catch (IOException failure) {
            // 用户停止会让子进程 stdout 立刻关闭，这条路径与真实故障无法从异常本身区分，
            // 所以先查停止标记：是用户停的就报「已停止」，不是才报通信失败。
            if (wasStopped(sessionId)) {
                sse.writeStopped(writer);
            } else {
                // 进程/协议层失败：已经说的、做的照样存下来并出片，再发错误帧，不假装完成。
                String reason = failure.getMessage() == null ? "与引擎通信失败" : failure.getMessage();
                saveUnfinished(sessionId, listener, null, reason, writer);
                renderAfterTurn(session, renderBefore, userText, writer);
                sse.writeError(writer, "agent_unavailable", reason);
            }
            sse.writeEnd(writer);
            finished.set(true);
        } finally {
            timing.markFinished();
            logTurnTiming(sessionId, continuation, timing);
            // 这里是唯一关进程的地方：一轮跑在 ChatTurns 的线程里，跑完才回到这里
            if (process != null) {
                runningTurns.remove(sessionId, process);
                process.close();
            }
            // 极端情况下（例如写帧时抛出 unchecked）确保连接被关闭而不是悬挂。
            if (!finished.get()) {
                sse.writeEnd(writer);
            }
        }
    }

    private void logTurnTiming(String sessionId, boolean continuation, ChatTurnTiming timing) {
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

}
