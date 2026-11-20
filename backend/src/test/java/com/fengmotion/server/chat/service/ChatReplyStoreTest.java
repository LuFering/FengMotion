package com.fengmotion.server.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatMessageRepository;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ChatReplyStoreTest {
    @Autowired private ChatMessageRepository messages;
    @Autowired private ChatSessionRepository sessions;
    @Autowired private ProjectRepository projects;
    @Autowired private TransactionTemplate transactions;
    @Autowired private ObjectMapper json;

    private String session() {
        Instant before = Instant.parse("2026-01-01T00:00:00Z");
        String projectId = UUID.randomUUID().toString();
        projects.save(new Project(projectId, "回复存储测试", null, null, null, before));
        String sessionId = UUID.randomUUID().toString();
        sessions.save(new ChatSession(sessionId, projectId, "测试", before, before));
        return sessionId;
    }

    @Test
    void persistsFullReplyWithSessionSequenceAndTouch() throws Exception {
        String sessionId = session();
        var store = new ChatReplyStore(messages, sessions, transactions);
        var tools = json.readTree("[{\"callId\":\"call\",\"textOffset\":2,\"order\":3,\"done\":true}]");
        var todos = json.readTree("[{\"content\":\"完成\",\"status\":\"completed\"}]");
        var usage = json.readTree("{\"totalTokens\":20}");
        var deliverables = json.readTree("[{\"path\":\"out.mp4\"}]");
        var reasoning = json.readTree("[{\"textOffset\":0,\"order\":2,\"text\":\"检查\"}]");

        var first = store.append(sessionId, "完成", "检查", tools, todos, usage, deliverables, reasoning);
        var second = store.append(sessionId, null, " ", json.createArrayNode(), json.createArrayNode(),
                json.createObjectNode(), json.createArrayNode(), json.createArrayNode());

        assertEquals(first, messages.findById(first.id()).orElseThrow());
        assertEquals(1, first.seq());
        assertEquals(2, second.seq());
        assertEquals(second.createdAt(), sessions.findById(sessionId).orElseThrow().updatedAt());
        assertEquals("", second.text());
        assertNull(second.reasoning());
        assertNull(second.toolCalls());
        assertNull(second.todos());
        assertNull(second.usage());
        assertNull(second.deliverables());
        assertNull(second.reasoningSegments());
        assertEquals(second, messages.findById(second.id()).orElseThrow());
    }

    @Test
    void rollsBackReplyAndSessionTouchWhenEnclosingTransactionFails() {
        String sessionId = session();
        Instant before = sessions.findById(sessionId).orElseThrow().updatedAt();
        var store = new ChatReplyStore(messages, sessions, transactions);
        var boundary = new TransactionTemplate(transactions.getTransactionManager());
        boundary.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);

        assertThrows(IllegalStateException.class, () -> boundary.execute(status -> {
            store.append(sessionId, "尚未提交", null, null, null, null, null, null);
            throw new IllegalStateException("abort");
        }));

        assertEquals(0, messages.countBySessionId(sessionId));
        assertEquals(before, sessions.findById(sessionId).orElseThrow().updatedAt());
    }
}
