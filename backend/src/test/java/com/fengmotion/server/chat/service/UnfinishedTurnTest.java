package com.fengmotion.server.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.chat.domain.ChatMessage;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatMessageRepository;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

/** 没跑完的一轮：已经说的、做的存成一条标明未完成的回复，不再像没发生过一样消失。 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class UnfinishedTurnTest {

    @Autowired ChatStreamService stream;
    @Autowired ChatSessionRepository sessions;
    @Autowired ChatMessageRepository messages;
    @Autowired ProjectRepository projects;

    private String session() {
        String projectId = UUID.randomUUID().toString();
        projects.save(new Project(projectId, "未完成测试", null, null, null, Instant.now()));
        String sessionId = UUID.randomUUID().toString();
        sessions.save(new ChatSession(sessionId, projectId, "咖啡", Instant.now(), Instant.now()));
        return sessionId;
    }

    @Test
    void savesWhatTheTurnProducedAndMarksItUnfinished() {
        String sessionId = session();
        var output = new StringWriter();
        var listener = stream.new SseListener(new PrintWriter(output), sessionId, true);
        listener.onStepStarted(1, 1);
        listener.onAssistantMessage(1, 1, "我先检查项目。", "");
        listener.onToolCall("a", "bash", "{}");

        stream.saveUnfinished(sessionId, listener, null, "DSH 子进程已退出", new PrintWriter(output));

        ChatMessage saved = messages.findAfterSeq(sessionId, 0, 10).getLast();
        assertEquals(ChatMessage.ROLE_ASSISTANT, saved.role());
        assertTrue(saved.text().startsWith("我先检查项目。"));
        assertTrue(saved.text().endsWith("> 这一轮没有完成：DSH 子进程已退出"));
        assertEquals(1, saved.toolCalls().size());
        assertTrue(output.toString().contains("event: completed"));
    }

    @Test
    void savesNothingWhenTheTurnProducedNothing() {
        String sessionId = session();
        var output = new StringWriter();
        var listener = stream.new SseListener(new PrintWriter(output), sessionId, true);

        stream.saveUnfinished(sessionId, listener, null, "启动失败", new PrintWriter(output));

        assertEquals(0, messages.countBySessionId(sessionId));
        assertEquals("", output.toString());
    }
}
