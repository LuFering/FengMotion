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
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Reads capabilities from the LLM service mounted in an isolated SDK runtime. */
@Component
public class DshModelCatalog {
    private static final int MAX_RESULT_BYTES = 2_000_000;
    private final HarnessProperties properties;
    private final ObjectMapper mapper = new ObjectMapper();

    public DshModelCatalog(HarnessProperties properties) { this.properties = properties; }

    /** maxTokens is the runtime's defaultMaxTokens, when known, not a hard maximum. */
    public record Entry(String id, String label, Long contextWindow, Long maxTokens, List<String> reasoningEfforts) {}

    /** Returns an empty list on any failure so the caller can use its configured model fallback. */
    public List<Entry> read(String providerId) {
        if (!properties.isEnabled() || providerId == null || providerId.isBlank()) return List.of();
        Path dir = null;
        Process process = null;
        try {
            dir = Files.createTempDirectory("fengmotion-catalog-");
            try { Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("rwx------")); }
            catch (UnsupportedOperationException ignored) { }
            Path plugin = dir.resolve("plugin.mjs");
            try (InputStream input = getClass().getResourceAsStream("/dsh-model-catalog/plugin.mjs")) {
                if (input == null) return List.of();
                Files.copy(input, plugin);
            }
            Path overlay = dir.resolve("overlay.yml");
            Files.writeString(overlay, "- insert:\n    - id: fengmotion-model-catalog\n      name: "
                    + mapper.writeValueAsString(plugin.toAbsolutePath().toString()) + "\n", StandardCharsets.UTF_8);
            Path request = dir.resolve("request.json"), result = dir.resolve("result.json");
            mapper.writeValue(request.toFile(), java.util.Map.of("provider", providerId));
            List<String> command = new ArrayList<>(List.of(properties.getBin(), "--profile", properties.getProfile()));
            if (properties.patchPath() != null) command.addAll(List.of("--patch", properties.patchPath().toString()));
            command.addAll(List.of("--patch", overlay.toString()));
            ProcessBuilder builder = new ProcessBuilder(command).directory(properties.workingDirectory().toFile())
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD);
            builder.environment().remove("ELECTRON_RUN_AS_NODE");
            builder.environment().put("FENGMOTION_CATALOG_REQUEST", request.toString());
            builder.environment().put("FENGMOTION_CATALOG_RESULT", result.toString());
            process = builder.start();
            long timeout = Math.max(1, Math.min(properties.getProbeTimeoutMs(), 600_000));
            long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeout);
            while (!Files.exists(result)) {
                if (!process.isAlive() || System.nanoTime() >= deadline) return List.of();
                Thread.sleep(50);
            }
            if (Files.size(result) > MAX_RESULT_BYTES) return List.of();
            return parseResult(mapper.readTree(result.toFile()));
        } catch (IOException | RuntimeException failure) {
            return List.of();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return List.of();
        } finally {
            if (process != null) {
                process.destroyForcibly();
                try { process.waitFor(2, TimeUnit.SECONDS); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            }
            if (dir != null) {
                try (var files = Files.list(dir)) {
                    for (Path file : files.toList()) Files.deleteIfExists(file);
                    Files.deleteIfExists(dir);
                } catch (IOException ignored) { }
            }
        }
    }

    static List<Entry> parseResult(JsonNode root) {
        if (root == null || !root.path("entries").isArray()) return List.of();
        List<Entry> entries = new ArrayList<>();
        for (JsonNode item : root.path("entries")) {
            if (!item.path("id").isTextual() || item.path("id").asText().isBlank()) return List.of();
            String id = item.path("id").asText();
            String label = item.path("label").isTextual() && !item.path("label").asText().isBlank()
                    ? item.path("label").asText() : id;
            List<String> efforts = null;
            if (item.path("reasoningEfforts").isArray()) {
                efforts = new ArrayList<>();
                for (JsonNode effort : item.path("reasoningEfforts")) {
                    if (!effort.isTextual()) return List.of();
                    efforts.add(effort.asText());
                }
                efforts = List.copyOf(efforts);
            }
            entries.add(new Entry(id, label, positiveLong(item.get("contextWindow")),
                    positiveLong(item.get("maxTokens")), efforts));
        }
        return List.copyOf(entries);
    }

    private static Long positiveLong(JsonNode node) {
        return node != null && node.isIntegralNumber() && node.canConvertToLong() && node.longValue() > 0
                ? node.longValue() : null;
    }
}
