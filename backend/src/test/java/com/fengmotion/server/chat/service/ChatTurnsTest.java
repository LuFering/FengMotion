package com.fengmotion.server.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;

/**
 * 一轮的运行不依赖订阅它的请求：断开再接上能补发，同一条消息只跑一次。
 *
 * <p>实测问题：前台 3 分钟转后台断开实时输出；切回对话把同一条消息又跑一遍；两个 agent 同时改同一个项目。</p>
 */
class ChatTurnsTest {

    private final ChatTurns turns = new ChatTurns(new ObjectMapper());

    private static void frame(PrintWriter out, String event, String data) {
        out.write("event: " + event + "\n");
        out.write("data: " + data + "\n\n");
        out.flush();
    }

    private static List<String> ids(String sse) {
        return sse.lines().filter(line -> line.startsWith("id: ")).map(line -> line.substring(4)).toList();
    }

    @Test
    void followerThatDisconnectsCanReplayFromItsLastEventAndTheTurnKeepsRunning() throws Exception {
        CountDownLatch firstWritten = new CountDownLatch(1), release = new CountDownLatch(1);
        var turn = turns.open("s", "m1", ChatTurns.Mode.START, out -> {
            frame(out, "delta", "{\"delta\":\"一\"}");
            firstWritten.countDown();
            try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
            frame(out, "delta", "{\"delta\":\"二\"}");
            frame(out, "end", "{\"type\":\"end\"}");
        });
        assertTrue(firstWritten.await(5, TimeUnit.SECONDS));

        // 第一个订阅者拿到第 1 帧后断开：用一个写出就报错的 writer 模拟
        StringWriter first = new StringWriter();
        PrintWriter broken = new PrintWriter(first) {
            @Override public boolean checkError() { return true; }
        };
        turns.follow(turn, 0, broken, null);
        assertEquals(List.of("1"), ids(first.toString()));

        release.countDown();
        StringWriter second = new StringWriter();
        turns.follow(turn, 1, new PrintWriter(second), null);
        assertEquals(List.of("2", "3"), ids(second.toString()), "从 Last-Event-ID 之后补发，不重复");
        assertTrue(second.toString().contains("\"二\""));
        assertTrue(turn.isDone());
    }

    @Test
    void sameMessageAttachesInsteadOfRunningAgain() throws Exception {
        AtomicInteger runs = new AtomicInteger();
        CountDownLatch release = new CountDownLatch(1);
        var running = turns.open("s", "m1", ChatTurns.Mode.START, out -> {
            runs.incrementAndGet();
            try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
            frame(out, "end", "{\"type\":\"end\"}");
        });
        assertSame(running, turns.open("s", "m1", ChatTurns.Mode.START, out -> runs.incrementAndGet()));
        assertSame(running, turns.open("s", "m1", ChatTurns.Mode.RERUN, out -> runs.incrementAndGet()), "还在跑时重新执行也只是接上");
        var busy = assertThrows(ApiException.class, () -> turns.open("s", "m2", ChatTurns.Mode.START, out -> { }));
        assertEquals("session_busy", busy.getCode());

        release.countDown();
        turns.follow(running, 0, new PrintWriter(new StringWriter()), null);
        assertSame(running, turns.open("s", "m1", ChatTurns.Mode.ATTACH, out -> runs.incrementAndGet()), "跑完后仍可补发");
        assertSame(running, turns.open("s", "m1", ChatTurns.Mode.START, out -> runs.incrementAndGet()), "跑完后再订阅也不重跑");
        assertEquals(1, runs.get());

        var again = turns.open("s", "m1", ChatTurns.Mode.RERUN, out -> {
            runs.incrementAndGet();
            frame(out, "end", "{\"type\":\"end\"}");
        });
        turns.follow(again, 0, new PrintWriter(new StringWriter()), null);
        assertEquals(2, runs.get(), "用户点重新执行才再跑一次");
    }

    @Test
    void attachOnlyNeverStartsATurn() {
        var missing = assertThrows(ApiException.class, () -> turns.open("s", "m1", ChatTurns.Mode.ATTACH, out -> { }));
        assertEquals("turn_not_running", missing.getCode());
    }

    @Test
    void heartbeatsWhileWaitingAndFailureBeforeAnyFrameStillEnds() {
        turns.heartbeatMillis = 30;
        var turn = turns.open("s", "m1", ChatTurns.Mode.START, out -> {
            try { Thread.sleep(200); } catch (InterruptedException ignored) { }
            throw new ApiException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "agent_unavailable", "Agent 未接入");
        });
        StringWriter sse = new StringWriter();
        turns.follow(turn, 0, new PrintWriter(sse), null);
        String text = sse.toString();
        assertTrue(text.split("event: heartbeat", -1).length - 1 >= 3, "等待期间要有心跳：" + text);
        assertTrue(text.contains("\"agent_unavailable\""));
        assertTrue(text.contains("event: end"));
    }
}
