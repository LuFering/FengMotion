package com.fengmotion.server.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.harness.config.HarnessProperties;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.workflow.service.ChatTurnRender;

/** 对话后自动渲染：先报「正在渲染」，渲染期间有心跳，最后报结果。 */
class ChatTurnRenderStreamTest {

    private final ObjectMapper json = new ObjectMapper();

    @Test
    void reportsRenderingKeepsAliveAndThenReportsVersion() throws Exception {
        ProjectRepository projects = mock(ProjectRepository.class);
        when(projects.findById("p1")).thenReturn(Optional.of(new Project("p1", "coffee", null, null, "/tmp/coffee", Instant.now())));
        ChatTurnRender turnRender = mock(ChatTurnRender.class);
        when(turnRender.renderIfChanged(eq("p1"), eq(Path.of("/tmp/coffee")), eq("before"), eq("咖啡"), any())).thenAnswer(call -> {
            ((Runnable) call.getArgument(4)).run();
            Thread.sleep(300); // 渲染中，请求线程不写任何帧
            return Optional.of(new ChatTurnRender.Result(ChatTurnRender.Result.RENDERED, 3L, "renders/project-1.mp4", "已出片 v3。"));
        });
        var service = new ChatStreamService(null, null, null, projects, new HarnessProperties(), null, null, null, null, json, turnRender);
        service.renderHeartbeatMillis = 50;
        var output = new StringWriter();

        service.renderAfterTurn(new ChatSession("s1", "p1", "咖啡", Instant.now(), Instant.now()), "before", "咖啡", new PrintWriter(output));

        List<JsonNode> frames = output.toString().lines().filter(line -> line.startsWith("data: "))
                .map(line -> { try { return json.readTree(line.substring(6)); } catch (Exception e) { throw new AssertionError(e); } }).toList();
        assertEquals("rendering", frames.getFirst().path("state").asText());
        assertTrue(frames.stream().filter(f -> f.path("type").asText().equals("heartbeat")).count() >= 3,
                "渲染期间要有心跳，否则前端 45 秒后按断线重连：" + frames);
        JsonNode last = frames.getLast();
        assertEquals("render", last.path("type").asText());
        assertEquals("rendered", last.path("state").asText());
        assertEquals(3, last.path("version").asInt());
        assertEquals("renders/project-1.mp4", last.path("artifactPath").asText());
    }

    @Test
    void sessionWithoutProjectWritesNothing() {
        var service = new ChatStreamService(null, null, null, mock(ProjectRepository.class), new HarnessProperties(), null, null, null, null, json, mock(ChatTurnRender.class));
        var output = new StringWriter();
        service.renderAfterTurn(new ChatSession("s1", null, "闲聊", Instant.now(), Instant.now()), "before", "你好", new PrintWriter(output));
        assertEquals("", output.toString());
    }
}
