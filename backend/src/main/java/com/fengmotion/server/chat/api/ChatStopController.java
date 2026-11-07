package com.fengmotion.server.chat.api;

import java.util.Map;

import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.chat.service.ChatSessionService;
import com.fengmotion.server.chat.service.ChatStreamService;

import lombok.RequiredArgsConstructor;

/**
 * 停止会话中正在执行的轮次。
 *
 * <p><strong>为什么单独一个 Controller</strong>：{@link ChatStreamController}
 * 的类级映射是 {@code /api/chat-sessions/{sessionId}/stream}，把 stop 写在里面
 * 会拼成 {@code …/stream/stop}，而不是用户能猜到的 {@code …/stop}（实测确认）。
 * 停止是会话级的动作，不属于「流」这个子资源，放在外层才符合直觉。</p>
 *
 * <p><strong>为什么必须有这个接口</strong>：DSH 的 SDK 协议没有 cancel 方法，
 * 前端点「停止」过去只是 abort 了浏览器侧的 SSE 连接，后端子进程照样跑完、
 * 照样落库 —— 用户以为停了，其实还在消耗 token、还在改文件。
 * 真正的停止只能在服务端把子进程杀掉。</p>
 */
@RestController
@RequestMapping("/api/chat-sessions/{sessionId}")
@RequiredArgsConstructor
public class ChatStopController {

    private final ChatSessionService sessions;
    private final ChatStreamService stream;

    /**
     * 停止本会话正在执行的轮次。
     *
     * <p>用 POST 而不是 DELETE：这是一个动作，不是对资源状态的幂等描述。
     * 重复调用返回 {@code stopped:false}，前端不需要区分「刚刚停掉」与
     * 「本来就没在跑」—— 两种情况下界面都该回到可输入状态。</p>
     *
     * <p>这里显式写全 {@code @RequestMapping(method=POST)} 而不是用
     * {@code @PostMapping}：在当前构建链路下，简写注解会被注解处理器降级为
     * {@code RuntimeInvisibleAnnotations}，Spring 在运行期读不到它，
     * 接口会静默变成 404（实测）。</p>
     *
     * @param sessionId 会话 ID
     * @return {@code stopped} 为 true 表示确实停掉了一个在跑的轮次
     */
    @RequestMapping(value = "/stop", method = RequestMethod.POST)
    public Map<String, Object> stop(@PathVariable String sessionId) {
        // 会话不存在时仍然返回 404，而不是 false —— 否则前端会把
        // 「会话被删了」当成「没有在跑的轮次」，安静地什么都不做。
        sessions.get(sessionId);
        return Map.of("stopped", stream.stop(sessionId));
    }
}
