package com.fengmotion.server.chat.api;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.chat.api.dto.ChatMessagePage;
import com.fengmotion.server.chat.api.dto.ChatMessageResponse;
import com.fengmotion.server.chat.api.dto.CreateChatMessageRequest;
import com.fengmotion.server.chat.api.dto.SendChatMessageResponse;
import com.fengmotion.server.chat.service.ChatMessageService;
import com.fengmotion.server.common.ApiException;

import lombok.RequiredArgsConstructor;

/**
 * 会话消息的 HTTP 接口。
 *
 * <p>消息不挂在项目路径下：会话 ID 已全局唯一，前端按会话直接读写（agent.md §2）。
 * 历史按时间正序返回，游标对客户端不透明。</p>
 */
@RestController
@RequestMapping("/api/chat-sessions/{sessionId}/messages")
@RequiredArgsConstructor
public class ChatMessageController {
    private final ChatMessageService service;

    /**
     * 分页读取会话历史，按时间正序。
     *
     * @param sessionId 会话 ID
     * @param cursor    可选的分页游标
     * @param limit     每页数量，默认 50，范围为 1 至 200
     * @return 当前页消息及下一页游标
     */
    @GetMapping
    public ChatMessagePage list(
            @PathVariable String sessionId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") int limit) {
        ChatMessageService.Page page = service.list(sessionId, cursor, limit);
        return new ChatMessagePage(
                page.items().stream().map(ChatMessageResponse::from).toList(),
                page.nextCursor());
    }

    /**
     * 发送一条用户消息。
     *
     * <p>契约 agent.md §3 规定返回 {@code 202 + { message, taskId? }}：消息已经保存，
     * 助手回复与任务由后续能力异步产生，不在这个响应里返回。这里不用 201，
     * 是因为「发送消息」的完成态包含消息之外的后续回复，201 会让人误以为整个回合已结束。</p>
     *
     * @param sessionId      会话 ID
     * @param request        消息正文、引用、附件与约束
     * @param idempotencyKey 可选的幂等键
     * @return 已保存的消息信封
     */
    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    public SendChatMessageResponse send(
            @PathVariable String sessionId,
            @RequestBody(required = false) CreateChatMessageRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        if (request == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "请求体不能为空");
        }
        ChatMessageService.Sent sent = service.send(sessionId, request, idempotencyKey);
        return new SendChatMessageResponse(ChatMessageResponse.from(sent.message()), sent.taskId());
    }
}
