package com.fengmotion.server.chat.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.support.TransactionCallback;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.chat.domain.ChatSession;
import com.fengmotion.server.chat.store.ChatMessageRepository;
import com.fengmotion.server.chat.store.ChatSessionRepository;
import com.fengmotion.server.harness.client.NativeHarnesses;
import com.fengmotion.server.harness.client.DshSdkSession;
import com.fengmotion.server.harness.config.HarnessProperties;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

class ChatSourceIsolationTest {
    @TempDir Path root;
    @Test void failedNativeTurnPersistsPartialReplyButDiscardsSourceChanges() throws Exception {
        Files.createDirectory(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"),"original");
        var projects=mock(ProjectRepository.class);
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project","Film",null,null,root.toString(),Instant.now())));
        var sessions=mock(ChatSessionRepository.class);
        when(sessions.findById("session")).thenReturn(Optional.of(new ChatSession("session","project","Chat",Instant.now(),Instant.now())));
        var messages=mock(ChatMessageRepository.class);
        when(messages.append(any())).thenAnswer(call->call.getArgument(0));
        var engine=mock(NativeHarnesses.class);
        var workspace=new AtomicReference<Path>();
        when(engine.run(any(),any(),any(),any(),any(),any(),any())).thenAnswer(call->{
            Path directory=call.getArgument(1);workspace.set(directory);
            assertNotEquals(root,directory);
            Files.writeString(directory.resolve("src/index.tsx"),"partial candidate");
            ((DshSdkSession.Listener)call.getArgument(4)).onTextDelta("已开始修改");
            throw new java.io.IOException("model disconnected");
        });
        var transaction=new TransactionTemplate() {
            @Override public <T> T execute(TransactionCallback<T> action) { return action.doInTransaction(null); }
        };
        var service=new ChatStreamService(null,engine,null,projects,new HarnessProperties(),null,sessions,messages,transaction,new ObjectMapper(),null);
        var output=new StringWriter();
        service.stream("session",new PrintWriter(output),"edit",null,"codex",null,null,null);
        assertEquals("original",Files.readString(root.resolve("src/index.tsx")));
        assertFalse(Files.exists(workspace.get()));
        assertTrue(output.toString().contains("model disconnected"));
        assertTrue(output.toString().contains("event: error"));
        verify(messages).append(argThat(message->message.text().contains("这一轮没有完成")));
    }
}
