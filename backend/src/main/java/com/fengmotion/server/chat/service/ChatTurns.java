package com.fengmotion.server.chat.service;

import java.io.PrintWriter;
import java.io.Writer;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;

import lombok.extern.slf4j.Slf4j;

/**
 * 一轮回复的运行与订阅分开：agent 在这里自己的线程里跑，每一帧按序号存进这一轮的缓冲；
 * 回复流请求只是订阅，补发已有的帧，再推后续的帧。
 *
 * <p><strong>为什么</strong>：原先一轮绑在 HTTP 请求上 —— 前台等 3 分钟就转后台断开实时输出，
 * 13 分钟强行杀掉；界面一断开（切页面、重开窗口）就接不回来，只能把同一条消息再跑一遍，
 * 实测出现过重复执行、两个 agent 同时改同一个项目。DSH 自己的做法也是运行不依赖界面，界面只订阅事件。</p>
 *
 * <p>每个会话只保留最近一轮：跑完之后仍可按序号补发，避免断线重连时把同一条消息再执行一遍。
 * 后端重启后缓冲为空，这时只订阅不新开，由用户决定要不要重新执行。</p>
 */
@Slf4j
@Component
public class ChatTurns {

    /** 订阅方式。 */
    public enum Mode {
        /** 发消息后的常规订阅：这条消息还没跑过就开一轮。 */
        START,
        /** 只接上已有的一轮（重连、切回对话）；没有就报 {@code turn_not_running}，不新开。 */
        ATTACH,
        /** 用户点了「重新执行」：上一轮跑完了也再跑一次。 */
        RERUN
    }

    /** 一个会话里跑过的一轮。序号从 1 开始，等于 SSE 的 {@code id}。 */
    public static final class Turn {
        private final String messageKey;
        private final List<String> frames = new ArrayList<>();
        private int firstSequence;
        private int retainedCharacters;
        private static final int MAX_REPLAY_CHARACTERS=4_000_000;
        private static final int MAX_REPLAY_FRAMES=20_000;
        private boolean done;
        private long finishedAt;

        Turn(String messageKey) {
            this.messageKey = messageKey;
        }

        public String messageKey() {
            return messageKey;
        }

        synchronized void add(String frame) {
            frames.add(frame);
            retainedCharacters+=frame.length();
            while(frames.size()>1 && (retainedCharacters>MAX_REPLAY_CHARACTERS || frames.size()>MAX_REPLAY_FRAMES)) {
                retainedCharacters-=frames.removeFirst().length();
                firstSequence++;
            }
            notifyAll();
        }

        synchronized void finish() {
            done = true;
            finishedAt=System.nanoTime();
            notifyAll();
        }

        public synchronized boolean isDone() {
            return done;
        }

        synchronized long finishedAt() { return finishedAt; }
        synchronized void expireReplay() {
            if(!done) return;
            firstSequence+=frames.size();
            frames.clear();
            retainedCharacters=0;
        }

        synchronized int size() {
            return firstSequence+frames.size();
        }

        /** 取第 {@code from} 帧之后的帧；暂时没有就最多等 {@code waitMs}，期间一轮结束也会醒来。 */
        synchronized List<String> await(int from, long waitMs) throws InterruptedException {
            if(from<firstSequence) throw new ApiException(HttpStatus.CONFLICT,"turn_replay_expired","实时消息缓冲已过期，请从已保存的消息记录读取结果");
            if (size() <= from && !done) wait(waitMs);
            if(from<firstSequence) throw new ApiException(HttpStatus.CONFLICT,"turn_replay_expired","实时消息缓冲已过期，请从已保存的消息记录读取结果");
            return size() <= from ? List.of() : List.copyOf(frames.subList(from-firstSequence,frames.size()));
        }

        /** agent 那边用它写帧：{@code writeFrame} 每写完一帧都会 flush，这里按空行切成一帧一条。 */
        PrintWriter writer() {
            return new PrintWriter(new Writer() {
                private final StringBuilder pending = new StringBuilder();

                @Override
                public void write(char[] buffer, int offset, int length) {
                    synchronized (pending) {
                        pending.append(buffer, offset, length);
                    }
                }

                @Override
                public void flush() {
                    synchronized (pending) {
                        int end;
                        while ((end = pending.indexOf("\n\n")) >= 0) {
                            String frame = pending.substring(0, end);
                            pending.delete(0, end + 2);
                            if (!frame.isBlank()) add(frame);
                        }
                    }
                }

                @Override
                public void close() {
                    flush();
                }
            }, true);
        }
    }

    private final ObjectMapper json;
    private final Map<String, Turn> latest = new ConcurrentHashMap<>();
    private final ExecutorService runner = new java.util.concurrent.ThreadPoolExecutor(0,4,30,TimeUnit.SECONDS,
            new java.util.concurrent.SynchronousQueue<>(),task -> {
        Thread thread = new Thread(task, "chat-turn");
        thread.setDaemon(true);
        return thread;
    },new java.util.concurrent.ThreadPoolExecutor.AbortPolicy());

    /** 等新帧时的心跳间隔：要明显小于前端的空闲断线判断（45 秒）。测试里调短。 */
    long heartbeatMillis = 15_000;

    public ChatTurns(ObjectMapper json) {
        this.json = json;
    }

    /**
     * 找到要订阅的那一轮，必要时开一轮。
     *
     * @param messageKey 这一轮对应的用户消息（通常是消息 ID）
     * @param body       真正执行这一轮：往给定的 writer 写帧，最后写 {@code end}
     * @throws ApiException 409 {@code session_busy}：另一条消息的一轮还在跑；
     *                      409 {@code turn_not_running}：只订阅，但这条消息没有在跑或跑过的一轮
     */
    public synchronized Turn open(String sessionId, String messageKey, Mode mode, Consumer<PrintWriter> body) {
        return open(sessionId, messageKey, mode, () -> null, body);
    }

    public synchronized Turn open(String sessionId, String messageKey, Mode mode,
            java.util.function.Supplier<com.fengmotion.server.project.service.ProjectOperationLock.Lease> admission,
            Consumer<PrintWriter> body) {
        Turn current = latest.get(sessionId);
        if (current != null && !current.isDone()) {
            if (current.messageKey().equals(messageKey)) return current;
            throw new ApiException(HttpStatus.CONFLICT, "session_busy", ChatStreamService.SESSION_BUSY_MESSAGE);
        }
        if (current != null && current.messageKey().equals(messageKey) && mode != Mode.RERUN) return current;
        if (mode == Mode.ATTACH) {
            throw new ApiException(HttpStatus.CONFLICT, "turn_not_running",
                    "这一轮没有在运行（应用可能重启过），可以重新执行。");
        }
        Turn turn = new Turn(messageKey);
        var activity = admission.get();
        latest.put(sessionId, turn);
        try { runner.execute(() -> {
            PrintWriter writer = turn.writer();
            try {
                body.accept(writer);
            } catch (RuntimeException failure) {
                // 正常结束会写 end；走到这里说明执行前就失败了，补一帧错误让订阅方收尾
                log.warn("对话一轮执行失败：session={}", sessionId, failure);
                writeFrame(writer, "error", errorFrame(failure));
                writeFrame(writer, "end", json.createObjectNode().put("type", "end"));
            } finally {
                writer.flush();
                turn.finish();
                if (activity != null) activity.close();
                trimCompletedReplay();
            }
        }); } catch (RuntimeException failure) {
            if (activity != null) activity.close();
            latest.remove(sessionId, turn);
            if(failure instanceof java.util.concurrent.RejectedExecutionException) {
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"chat_capacity_full","聊天执行已达并发上限或服务正在关闭，请稍后重试");
            }
            throw failure;
        }
        return turn;
    }

    @jakarta.annotation.PreDestroy public void close() {
        runner.shutdownNow();
        try { runner.awaitTermination(5,TimeUnit.SECONDS); }
        catch(InterruptedException interrupted) { Thread.currentThread().interrupt(); }
    }

    private synchronized void trimCompletedReplay() {
        latest.values().stream().filter(Turn::isDone)
                .sorted(java.util.Comparator.comparingLong(Turn::finishedAt).reversed()).skip(32)
                .forEach(Turn::expireReplay);
    }

    /**
     * 把这一轮推给一个订阅者，直到这一轮结束并补发完，或者订阅者断开。
     *
     * <p>订阅者断开只是不再推送，这一轮照常跑完、照常落库。</p>
     *
     * @param afterSeq 订阅者已经收到的最后一帧序号（{@code Last-Event-ID}）；从头订阅为 0
     */
    public void follow(Turn turn, long afterSeq, PrintWriter out, Runnable flush) {
        int next = (int) Math.max(0, Math.min(afterSeq, Integer.MAX_VALUE));
        try {
            while (true) {
                List<String> batch = turn.await(next, heartbeatMillis);
                if (batch.isEmpty()) {
                    if (turn.isDone() && next >= turn.size()) return;
                    out.write("event: heartbeat\ndata: {\"type\":\"heartbeat\"}\n\n");
                } else {
                    for (String frame : batch) {
                        next++;
                        out.write("id: " + next + "\n" + frame + "\n\n");
                    }
                }
                out.flush();
                if (flush != null) flush.run();
                if (out.checkError()) return;
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } catch(ApiException expired) {
            writeFrame(out,"error",errorFrame(expired));
            writeFrame(out,"end",json.createObjectNode().put("type","end"));
            if(flush!=null) flush.run();
        }
    }

    private void writeFrame(PrintWriter writer, String event, ObjectNode data) {
        writer.write("event: " + event + "\n");
        writer.write("data: " + data + "\n\n");
        writer.flush();
    }

    private ObjectNode errorFrame(RuntimeException failure) {
        ObjectNode data = json.createObjectNode();
        ObjectNode error = data.putObject("error");
        error.put("code", failure instanceof ApiException api ? api.getCode() : "agent_error");
        error.put("message", failure.getMessage() == null ? "执行失败" : failure.getMessage());
        error.put("requestId", "req_" + java.util.UUID.randomUUID());
        return data;
    }
}
