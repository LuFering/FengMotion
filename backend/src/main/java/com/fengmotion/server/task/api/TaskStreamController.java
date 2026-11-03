package com.fengmotion.server.task.api;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.domain.TaskEvent;
import com.fengmotion.server.task.service.TaskService;

import lombok.RequiredArgsConstructor;

/**
 * 任务事件流：把任务的状态迁移实时推给前端。
 *
 * <p><strong>为什么用轮询任务表而不是事件推送</strong>：任务状态已经全部落库，
 * 事件流只需按序号增量读取，不需要在内存里维护订阅者列表。好处是服务重启后
 * 前端带 {@code Last-Event-ID} 重连就能补齐 —— 而内存订阅者一并丢失。</p>
 *
 * <p><strong>为什么渲染在任务里而不是同步返回</strong>：渲染要几十秒到几分钟，
 * 同步 HTTP 会让浏览器超时、也无法中途取消。提交返回 ID，进度走这个流。</p>
 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class TaskStreamController {

    /** 轮询间隔：任务进度变化不频繁，200ms 足够且开销小。 */
    private static final long POLL_MS = 200;

    /** 事件流最长存活时间：超过就关掉，由前端重连。 */
    private static final long STREAM_TIMEOUT_MS = Duration.ofMinutes(30).toMillis();

    private final TaskService tasks;

    /**
     * 订阅任务事件。
     *
     * @param taskId      任务 ID
     * @param lastEventId 客户端已收到的最后序号；用于断线补发
     * @return SSE 流
     */
    @GetMapping(path = "/tasks/{taskId}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(@PathVariable String taskId,
                             @RequestHeader(value = "Last-Event-ID", required = false) String lastEventId) {
        // 任务不存在时直接 404，而不是开一条永远不会有内容的流
        tasks.get(taskId);

        long from = parseSeq(lastEventId);
        SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MS);
        ScheduledExecutorService pump = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "task-sse-" + taskId.substring(0, 8));
            thread.setDaemon(true);
            return thread;
        });

        emitter.onCompletion(() -> pump.shutdownNow());
        emitter.onTimeout(() -> {
            emitter.complete();
            pump.shutdownNow();
        });
        emitter.onError(ignored -> pump.shutdownNow());

        // 用数组持有游标：lambda 里要更新它
        long[] cursor = { from };
        pump.scheduleWithFixedDelay(() -> {
            try {
                List<TaskEvent> batch = tasks.eventsAfter(taskId, cursor[0]);
                for (TaskEvent event : batch) {
                    emitter.send(SseEmitter.event()
                            .id(String.valueOf(event.seq()))
                            .name(event.kind())
                            .data(event, MediaType.APPLICATION_JSON));
                    cursor[0] = event.seq();
                }
                Task task = tasks.get(taskId);
                if (task.isTerminal() && batch.isEmpty()) {
                    // 终态且已发完：主动收尾，别让前端挂一条永不结束的连接
                    emitter.complete();
                    pump.shutdownNow();
                }
            } catch (IOException closed) {
                // 客户端断开是正常路径
                pump.shutdownNow();
            } catch (RuntimeException failure) {
                try {
                    emitter.send(SseEmitter.event().name("error").data(
                            "{\"message\":\"" + escape(failure.getMessage()) + "\"}",
                            MediaType.APPLICATION_JSON));
                } catch (IOException ignored) {
                    // 已经断了
                }
                emitter.completeWithError(failure);
                pump.shutdownNow();
            }
        }, 0, POLL_MS, TimeUnit.MILLISECONDS);

        return emitter;
    }

    /**
     * 解析 Last-Event-ID。
     *
     * @param raw 头部原文
     * @return 起始序号；缺失或非法时为 0（从头补发）
     */
    private static long parseSeq(String raw) {
        if (raw == null || raw.isBlank()) {
            return 0L;
        }
        try {
            return Math.max(0L, Long.parseLong(raw.trim()));
        } catch (NumberFormatException malformed) {
            // 格式不对就从头补：宁可重复发，也不要漏发
            return 0L;
        }
    }

    /**
     * 极简 JSON 字符串转义，仅用于错误消息。
     *
     * @param text 原文
     * @return 转义后的文本
     */
    private static String escape(String text) {
        if (text == null) {
            return "";
        }
        return text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
    }
}
