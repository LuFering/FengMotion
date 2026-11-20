package com.fengmotion.server.chat.api;

import java.io.IOException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.chat.domain.ChatMessage;
import com.fengmotion.server.chat.service.ChatMessageService;
import com.fengmotion.server.chat.service.ChatSessionService;
import com.fengmotion.server.chat.service.ChatStreamService;
import com.fengmotion.server.chat.service.ChatTurns;
import com.fengmotion.server.common.ApiException;

import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;

/**
 * 会话回复流（SSE）。
 *
 * <p>把 DSH 引擎的一次执行投影成 SSE：先发 {@code status} 帧表达阶段进度，
 * 成功时发 {@code completed}（携带完整助手消息）与 {@code end}，失败时发
 * {@code error} 与 {@code end}。<strong>不发 {@code delta} 帧</strong>——DSH 的 SDK
 * 通道拿不到 token 级增量，没有增量就不假装有增量（见 {@code docs/harness集成与接口清单.md} §1.1）。</p>
 *
 * <p>为什么手动写响应体而不是返回 {@code SseEmitter}：前端用
 * {@code Accept: text/event-stream} 发起请求，而前置校验失败时唯一可能的响应是
 * JSON 错误信封；交给内容协商会先按 Accept 选不出可写的表示，把 503 变成 406。
 * 这里先直接设定状态码与 Content-Type 写出错误信封，校验通过后再切换为流式写出。</p>
 *
 * <p>重连语义：一轮在 {@link ChatTurns} 里跑，不依赖这个请求。请求只是订阅：
 * 带 {@code Last-Event-ID} 时从那一帧之后补发；一轮跑完后仍可补发，不会把同一条消息再执行一遍。
 * 请求断开只是不再推送，这一轮照常跑完、照常落库。</p>
 */
@RestController
@RequestMapping("/api/chat-sessions/{sessionId}/stream")
@RequiredArgsConstructor
public class ChatStreamController {
    private final ChatSessionService sessions;
    private final ChatMessageService messages;
    private final ChatStreamService stream;
    private final ChatTurns turns;
    private final com.fengmotion.server.creation.service.ResourceContextBuilder resourceContexts;
    private final com.fasterxml.jackson.databind.ObjectMapper json;

    /**
     * 订阅会话回复流。
     *
     * @param sessionId   会话 ID
     * @param lastEventId 客户端已收到的事件序号；当前只校验格式，不做断点续读
     * @param prompt      本轮要发送给引擎的用户消息；缺省时取该会话最后一条用户消息
     * @param response    用于直接写出 SSE 或错误信封，绕过内容协商
     * @throws IOException 写响应失败时抛出
     */
    @GetMapping
    public void stream(
            @PathVariable String sessionId,
            @RequestHeader(value = "Last-Event-ID", required = false) String lastEventId,
            @RequestParam(value = "prompt", required = false) String prompt,
            @RequestParam(value = "harness", required = false) String engine,
            @RequestParam(value = "model", required = false) String model,
            @RequestParam(value = "reasoningEffort", required = false) String reasoningEffort,
            @RequestParam(value = "attach", required = false) boolean attach,
            @RequestParam(value = "rerun", required = false) boolean rerun,
            HttpServletResponse response) throws IOException {
        try {
            // 会话不存在时先返回 404，避免把「会话被删」显示成「Agent 不可用」。
            sessions.get(sessionId);

            long afterSeq = parseLastEventId(lastEventId);

            // 引擎不可用是比「没有可发送的内容」更根本的阻塞：先给出 503，
            // 否则用户会收到「请先发一条消息」这种指向错误方向的提示。
            if (!stream.isAvailable(engine)) {
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "agent_unavailable",
                        "Agent 未接入或不可用");
            }

            stream.validateSelection(engine, model, reasoningEffort);
            Resolution resolved = resolvePrompt(sessionId, prompt);
            if (resolved == null) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                        "没有可发送的内容：请在会话中先发一条消息，或用 prompt 参数指定");
            }
            /* 重连（带 Last-Event-ID）和切回对话（attach）只订阅不新开：后端重启后缓冲没了，
               这时让用户决定要不要重新执行，而不是悄悄把同一条消息再跑一遍。 */
            ChatTurns.Mode mode = lastEventId != null || attach ? ChatTurns.Mode.ATTACH
                    : rerun ? ChatTurns.Mode.RERUN : ChatTurns.Mode.START;
            ChatTurns.Turn turn = turns.open(sessionId, resolved.key(), mode, writer ->
                    stream.stream(sessionId, writer, resolved.text(), resolved.attachments(), engine, model, reasoningEffort, null));

            // 校验全部通过后才切换到流式响应头：一旦写出 200，就无法再改状态码。
            response.setStatus(HttpStatus.OK.value());
            response.setContentType(MediaType.TEXT_EVENT_STREAM_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            // 关闭中间层缓冲：否则代理会攒满一批才下发，前端看不到进度。
            response.setHeader("Cache-Control", "no-cache, no-transform");
            response.setHeader("X-Accel-Buffering", "no");

            PrintWriter writer = response.getWriter();
            // 把 flushBuffer 交给服务层：Tomcat 的 Writer.flush() 只刷 Writer 缓冲，
            // 响应本身还有一层；不显式 flushBuffer，delta 帧会攒到最后一起到。
            turns.follow(turn, afterSeq, writer, () -> {
                try {
                    response.flushBuffer();
                } catch (IOException ignored) {
                    // 客户端断开时 flush 会失败；follow 随后据 checkError 停止推送，这一轮不受影响。
                }
            });
        } catch (ApiException ex) {
            writeError(response, ex);
        }
    }

    /**
     * 确定本轮要发给引擎的用户消息。
     *
     * <p>优先用显式 {@code prompt}；否则取该会话最后一条用户消息。这样「先 POST 消息、
     * 再订阅流」的常规流程不需要重复传正文，也避免正文在两条请求间不一致。</p>
     *
     * @param sessionId 会话 ID
     * @param prompt    显式指定的正文；可为 null
     * @return 要发送的正文；找不到时返回 null
     */
    private Resolution resolvePrompt(String sessionId, String prompt) {
        // 显式 prompt 参数不带附件：它是调试/重放通道，附件只能来自已提交的用户消息。
        if (prompt != null && !prompt.isBlank()) {
            return new Resolution("prompt:" + prompt, prompt, null);
        }
        // 历史按正序返回，这里翻到最后一页取最后一条用户消息。
        ChatMessageService.Page page = messages.list(sessionId, null, 200);
        List<ChatMessage> items = new java.util.ArrayList<>(page.items());
        while (page.nextCursor() != null) {
            page = messages.list(sessionId, page.nextCursor(), 200);
            // 只保留最后一条用户消息与当前页，避免长对话全部驻留内存。
            ChatMessage previousUser = null;
            for (ChatMessage item : items) if (ChatMessage.ROLE_USER.equals(item.role())) previousUser = item;
            items = new java.util.ArrayList<>();
            if (previousUser != null) items.add(previousUser);
            items.addAll(page.items());
        }
        for (int i = items.size() - 1; i >= 0; i--) {
            ChatMessage item = items.get(i);
            if (ChatMessage.ROLE_USER.equals(item.role())
                    && item.text() != null && !item.text().isBlank()) {
                var resources = resourceContexts.build(item.references());
                String text = item.text();
                if (resources.available()) {
                    text += "\n\n用户随这条消息指定的资源及用途：\n" + resources.description();
                }
                return new Resolution(item.id(), text, item.attachments());
            }
        }
        return null;
    }

    /**
     * 解析出的本轮输入。
     *
     * @param key         这一轮对应哪条用户消息：同一条消息只跑一次，重连时据此接上
     * @param text        用户正文
     * @param attachments 该条消息带的附件元信息；没有时为 null
     */
    private record Resolution(String key, String text, com.fasterxml.jackson.databind.JsonNode attachments) {
    }

    /** {@code Last-Event-ID} 是这一轮里的帧序号；缺省为 0（从头订阅）。 */
    private static long parseLastEventId(String raw) {
        if (raw == null) return 0;
        try {
            long seq = Long.parseLong(raw.trim());
            if (seq >= 0) return seq;
        } catch (NumberFormatException ignored) {
            // 落到下面的校验错误
        }
        throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "Last-Event-ID 无效");
    }

    /** 写出与 {@code ApiExceptionHandler} 相同的错误信封。 */
    private void writeError(HttpServletResponse response, ApiException ex) throws IOException {
        response.setStatus(ex.getStatus().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        json.writeValue(response.getWriter(), java.util.Map.of("error", java.util.Map.of(
                "code", ex.getCode(), "message", ex.getMessage(), "requestId", "req_" + UUID.randomUUID())));
    }
}
