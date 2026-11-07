package com.fengmotion.server.harness.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.harness.config.HarnessProperties;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** One isolated DSH model call, without creating an Agent or reading credentials. */
@Component
public class DshDirectTextModel {
    private final HarnessProperties properties;
    private final ObjectMapper mapper;

    public DshDirectTextModel(HarnessProperties properties, ObjectMapper mapper) {
        this.properties = properties;
        this.mapper = mapper;
    }

    public record Request(String provider, String model, String system, String prompt, int maxTokens, long timeoutMs) {}
    public record Result(String text, JsonNode usage) {}

    /** Uses the configured DSH profile and optional provider patch. */
    public Result generate(Request request) throws IOException, InterruptedException {
        if (!properties.isEnabled()) throw new IOException("DSH_DISABLED");
        if (request == null || request.provider() == null || request.provider().isBlank()
                || request.model() == null || request.model().isBlank() || request.prompt() == null
                || request.maxTokens() <= 0 || request.timeoutMs() <= 0 || request.timeoutMs() > 600_000) {
            throw new IllegalArgumentException("Invalid direct model request");
        }
        Path dir = Files.createTempDirectory("fengmotion-direct-");
        Process process = null;
        try {
            try { Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("rwx------")); }
            catch (UnsupportedOperationException ignored) { }
            Path plugin = dir.resolve("plugin.mjs");
            try (InputStream input = getClass().getResourceAsStream("/dsh-direct-text/plugin.mjs")) {
                if (input == null) throw new IOException("DSH_BRIDGE_RESOURCE_MISSING");
                Files.copy(input, plugin);
            }
            Path overlay = dir.resolve("overlay.yml");
            Files.writeString(overlay, "- insert:\n    - id: fengmotion-direct-text\n      name: "
                    + mapper.writeValueAsString(plugin.toAbsolutePath().toString()) + "\n", StandardCharsets.UTF_8);
            Path requestFile = dir.resolve("request.json");
            Path resultFile = dir.resolve("result.json");
            mapper.writeValue(requestFile.toFile(), request);
            List<String> command = new ArrayList<>(List.of(properties.getBin(), "--profile", properties.getProfile()));
            if (properties.patchPath() != null) command.addAll(List.of("--patch", properties.patchPath().toString()));
            command.addAll(List.of("--patch", overlay.toString()));
            ProcessBuilder builder = new ProcessBuilder(command).directory(properties.workingDirectory().toFile())
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD);
            builder.environment().remove("ELECTRON_RUN_AS_NODE");
            builder.environment().put("FENGMOTION_DIRECT_REQUEST", requestFile.toString());
            builder.environment().put("FENGMOTION_DIRECT_RESULT", resultFile.toString());
            process = builder.start();
            long deadline = System.nanoTime() + Duration.ofMillis(request.timeoutMs() + 20_000).toNanos();
            while (!Files.exists(resultFile)) {
                if (!process.isAlive()) throw new IOException("DSH_PROCESS_EXITED (exit " + process.exitValue() + ")");
                if (System.nanoTime() >= deadline) throw new IOException("DSH_DIRECT_TIMEOUT");
                Thread.sleep(50);
            }
            JsonNode result = mapper.readTree(resultFile.toFile());
            if (result.has("error")) {
                String error = result.path("error").asText("BRIDGE_FAILURE");
                String code = result.path("code").asText("");
                throw new IOException("DSH_DIRECT_" + error + (code.isEmpty() ? "" : " (" + code + ")"));
            }
            if (!result.has("text") || !result.get("text").isTextual()) throw new IOException("DSH_DIRECT_INVALID_RESPONSE");
            return new Result(result.get("text").asText(), result.get("usage"));
        } finally {
            if (process != null) {
                process.destroy();
                if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly();
            }
            try (var files = Files.list(dir)) {
                for (Path path : files.toList()) Files.deleteIfExists(path);
            }
            Files.deleteIfExists(dir);
        }
    }
}
