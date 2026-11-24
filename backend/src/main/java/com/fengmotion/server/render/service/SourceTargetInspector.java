package com.fengmotion.server.render.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;

@Component
public class SourceTargetInspector {
    private final ObjectMapper json;
    private final String directory;
    private final String modules;
    private final String node;

    public SourceTargetInspector(ObjectMapper json,
            @Value("${fengmotion.remotion.project-dir:}") String directory,
            @Value("${fengmotion.remotion.node-modules:}") String modules,
            @Value("${fengmotion.remotion.node:node}") String node) {
        this.json = json;
        this.directory = directory;
        this.modules = modules;
        this.node = node;
    }

    public Span inspect(String text, int line, int column) { return run(text, line, column, false); }
    public void validate(String text) { run(text, 0, 0, true); }

    private Span run(String text, int line, int column, boolean validateOnly) {
        if (text == null || text.length() > 1_048_576) throw invalid();
        Path script = script();
        Path output = null;
        Path input = null;
        Process process = null;
        try {
            output = Files.createTempFile("fm-source-target-", ".json");
            input = Files.createTempFile("fm-source-input-", ".json");
            Files.write(input, json.writeValueAsBytes(json.createObjectNode().put("text", text)
                    .put("line", line).put("column", column).put("validateOnly", validateOnly)));
            ProcessBuilder builder = new ProcessBuilder(node, script.toString()).redirectInput(input.toFile()).redirectOutput(output.toFile())
                    .redirectError(ProcessBuilder.Redirect.DISCARD);
            if (!modules.isBlank()) builder.environment().put("FENGMOTION_NODE_MODULES", Path.of(modules).toAbsolutePath().normalize().toString());
            process = builder.start();
            if (!process.waitFor(10, TimeUnit.SECONDS)) throw unavailable();
            var result = json.readTree(com.fengmotion.server.common.ProcessOutput.read(output, 200_000));
            if (process.exitValue() != 0 || result == null || !result.path("ok").asBoolean()) throw invalid();
            if (validateOnly) return null;
            if (!result.path("start").isIntegralNumber() || !result.path("start").canConvertToInt()
                    || !result.path("end").isIntegralNumber() || !result.path("end").canConvertToInt()) throw invalid();
            int start = result.path("start").intValue();
            int end = result.path("end").intValue();
            String code = result.path("code").textValue();
            if (start < 0 || end <= start || end > text.length() || end - start > 32768 || code == null
                    || !text.substring(start, end).equals(code)) throw invalid();
            return new Span(start, end, code);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw unavailable();
        } catch (IOException failure) { throw unavailable(); }
        finally {
            if (process != null && process.isAlive()) process.destroyForcibly();
            if (output != null) try { Files.deleteIfExists(output); } catch (IOException ignored) { }
            if (input != null) try { Files.deleteIfExists(input); } catch (IOException ignored) { }
        }
    }

    private Path script() {
        try { return RenderRuntimePaths.script(directory, "inspect-source-target.mjs"); }
        catch (ApiException failure) { throw unavailable(); }
    }

    private static ApiException invalid() {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "source_target_invalid", "所选位置不再对应有效 JSX，或修改结果无法解析；请重新选择目标");
    }
    private static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "source_inspector_unavailable", "源码解析器不可用，请检查 Node 和共享 Babel 依赖");
    }
    public record Span(int start, int end, String code) { }
}
