package com.fengmotion.server.project.store;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;

import lombok.RequiredArgsConstructor;

/** 保存最近一次创作的要求、问题和资源，让刷新页面与下一轮回答仍有依据。 */
@Component
@RequiredArgsConstructor
public class CreationStateStore {
    private static final String FILE = "creation-state.json";
    private static final int MAX_BYTES = 16_000_000;
    private final ObjectMapper json;

    public State read(Path root) {
        Path file = root.resolve(FILE);
        if(Files.isSymbolicLink(file)) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"creation_state_unreadable","创作记录不能是符号链接");
        if (!Files.isRegularFile(file,java.nio.file.LinkOption.NOFOLLOW_LINKS)) return null;
        try {
            if (Files.size(file) > MAX_BYTES) throw new IOException("创作记录超过大小限制");
            String content = com.fengmotion.server.common.ProcessOutput.read(file, MAX_BYTES);
            var document = json.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY,
                    com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(content);
            if (document == null || !document.isObject()) throw new IOException("创作记录必须是JSON对象");
            return json.treeToValue(document, State.class);
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "creation_state_unreadable",
                    "无法读取上轮创作记录：" + failure.getMessage());
        }
    }

    public void write(Path root, State state) {
        Path temporary = null;
        try {
            if(Files.isSymbolicLink(root.resolve(FILE))) throw new IOException("创作记录不能是符号链接");
            if (state == null) throw new IOException("创作记录不能为空");
            byte[] content = json.writerWithDefaultPrettyPrinter().writeValueAsBytes(state);
            if (content.length > MAX_BYTES) throw new IOException("创作记录超过大小限制");
            temporary=Files.createTempFile(root,".creation-state-",".tmp");
            Files.write(temporary, content);
            Files.move(temporary, root.resolve(FILE), StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "creation_state_write_failed",
                    "无法保存创作记录：" + failure.getMessage());
        } finally {
            try { if(temporary!=null) Files.deleteIfExists(temporary); } catch(IOException ignored) { }
        }
    }

    public State state(String status, String intent, String reply, JsonNode references,
                       String artifactPath, Long version, String error) {
        return state(status, intent, reply, references, artifactPath, version, error, null);
    }

    public State state(String status, String intent, String reply, JsonNode references,
                       String artifactPath, Long version, String error, String requestId) {
        return state(status, intent, reply, references, artifactPath, version, error, requestId, null);
    }

    public State state(String status, String intent, String reply, JsonNode references,
                       String artifactPath, Long version, String error, String requestId, String phase) {
        return state(status, intent, reply, references, artifactPath, version, error, requestId, phase, null);
    }

    public State state(String status, String intent, String reply, JsonNode references,
                       String artifactPath, Long version, String error, String requestId, String phase, Boolean sessionSaved) {
        return new State(status, intent, reply, references, artifactPath, version, error, Instant.now().toString(), requestId, phase, sessionSaved);
    }

    /**
     * 创作状态快照。
     *
     * @param userMessageId 触发这次创作的用户消息 ID。
     *                      <p>刷新恢复时前端要靠它把「本轮未改动工程」这类结论
     *                      挂回正确的消息；没有它就只能降级不显示。</p>
     */
    public record State(String state, String intent, String reply, JsonNode references,
                        String artifactPath, Long version, String error, String updatedAt,
                        String requestId, String phase, Boolean sessionSaved,
                        String userMessageId,
                        String sessionId) {
        public State(String state, String intent, String reply, JsonNode references,
                     String artifactPath, Long version, String error, String updatedAt) {
            this(state, intent, reply, references, artifactPath, version, error, updatedAt, null, null, null, null, null);
        }

        public State(String state, String intent, String reply, JsonNode references,
                     String artifactPath, Long version, String error, String updatedAt,
                     String requestId) {
            this(state, intent, reply, references, artifactPath, version, error, updatedAt, requestId, null, null, null, null);
        }

        public State(String state, String intent, String reply, JsonNode references,
                     String artifactPath, Long version, String error, String updatedAt,
                     String requestId, String phase) {
            this(state, intent, reply, references, artifactPath, version, error, updatedAt, requestId, phase, null, null, null);
        }

        public State(String state, String intent, String reply, JsonNode references,
                     String artifactPath, Long version, String error, String updatedAt,
                     String requestId, String phase, Boolean sessionSaved) {
            this(state, intent, reply, references, artifactPath, version, error, updatedAt, requestId, phase, sessionSaved, null, null);
        }
    }
}
