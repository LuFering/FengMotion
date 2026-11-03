package com.fengmotion.server.chat.api;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.chat.api.dto.ChatSessionPage;
import com.fengmotion.server.chat.api.dto.ChatSessionResponse;
import com.fengmotion.server.chat.api.dto.CreateChatSessionRequest;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.service.ChatSessionService;
import com.fengmotion.server.common.ApiException;

import lombok.RequiredArgsConstructor;

/**
 * 项目下对话会话的 HTTP 接口。
 */
@RestController
@RequestMapping("/api/projects/{projectId}/chat-sessions")
@RequiredArgsConstructor
public class ChatSessionController {
    private final ChatSessionService service;

    /**
     * 在项目下创建会话。
     *
     * @param projectId 路径中的项目 ID
     * @param request   请求体；其中的项目 ID 必须与路径一致
     * @return 创建成功的会话本体（不套信封），HTTP 状态码为 201
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ChatSessionResponse create(
            @PathVariable String projectId,
            @RequestBody CreateChatSessionRequest request) {
        if (request == null) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "validation_error",
                    "请求体不能为空");
        }

        // 请求体中的项目 ID 必须与路径一致。
        if (!projectId.equals(request.projectId())) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "validation_error",
                    "请求体中的项目 ID 与路径不一致");
        }

        ChatSession session = service.create(projectId, request.title());
        return ChatSessionResponse.from(session);
    }

    /**
     * 分页查询项目下的会话，按最近更新倒序。
     *
     * @param projectId 项目 ID
     * @param cursor    可选的分页游标
     * @param limit     每页数量，默认 50，范围为 1 至 200
     * @return 当前页会话及下一页游标
     */
    @GetMapping
    public ChatSessionPage list(
            @PathVariable String projectId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") int limit) {
        ChatSessionService.Page page = service.list(projectId, cursor, limit);
        return new ChatSessionPage(
                page.items().stream().map(ChatSessionResponse::from).toList(),
                page.nextCursor());
    }
}
