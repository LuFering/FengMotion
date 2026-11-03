package com.fengmotion.server.chat.api;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.chat.api.dto.ChatSessionResponse;
import com.fengmotion.server.chat.service.ChatSessionService;

import lombok.RequiredArgsConstructor;

/**
 * 单个对话会话的 HTTP 接口。
 *
 * <p>详情不挂在项目路径下，因为会话 ID 全局唯一，前端按会话 ID 直接读取。</p>
 */
@RestController
@RequestMapping("/api/chat-sessions")
@RequiredArgsConstructor
public class ChatSessionDetailController {
    private final ChatSessionService service;

    /**
     * 根据会话 ID 查询详情。
     *
     * @param sessionId 会话 ID
     * @return 会话本体；不存在时由服务层返回 404
     */
    @GetMapping("/{sessionId}")
    public ChatSessionResponse get(@PathVariable String sessionId) {
        return ChatSessionResponse.from(service.get(sessionId));
    }

    /**
     * 删除会话；消息软删除，保留审计记录（agent.md §5）。
     *
     * <p>契约 README §2.3：删除成功返回 204 且没有响应体。</p>
     *
     * @param sessionId 会话 ID
     */
    @DeleteMapping("/{sessionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String sessionId) {
        service.delete(sessionId);
    }
}
