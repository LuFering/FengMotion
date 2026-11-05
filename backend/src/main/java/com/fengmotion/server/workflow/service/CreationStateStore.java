package com.fengmotion.server.workflow.service;

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
    private final ObjectMapper json;

    public State read(Path root) {
        Path file = root.resolve(FILE);
        if (!Files.isRegularFile(file)) return null;
        try {
            return json.readValue(file.toFile(), State.class);
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "creation_state_unreadable",
                    "无法读取上轮创作记录：" + failure.getMessage());
        }
    }

    public void write(Path root, State state) {
        Path temporary = root.resolve(FILE + ".tmp");
        try {
            json.writerWithDefaultPrettyPrinter().writeValue(temporary.toFile(), state);
            Files.move(temporary, root.resolve(FILE), StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "creation_state_write_failed",
                    "无法保存创作记录：" + failure.getMessage());
        }
    }

    public State state(String status, String intent, String reply, JsonNode references,
                       String artifactPath, Long version, String error) {
        return new State(status, intent, reply, references, artifactPath, version, error, Instant.now().toString());
    }

    public record State(String state, String intent, String reply, JsonNode references,
                        String artifactPath, Long version, String error, String updatedAt) { }
}
