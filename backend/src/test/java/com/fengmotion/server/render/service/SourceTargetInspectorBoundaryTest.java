package com.fengmotion.server.render.service;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;

class SourceTargetInspectorBoundaryTest {
    @TempDir Path root;

    private SourceTargetInspector inspector(String script) throws Exception {
        Files.writeString(root.resolve("inspect-source-target.mjs"), script);
        return new SourceTargetInspector(new ObjectMapper(), root.toString(), "", "node");
    }

    @Test void aChildThatNeverReadsStdinCannotBlockBeforeTheTimeout() throws Exception {
        Path pid = root.resolve("pid.txt");
        var inspector = inspector("import {writeFileSync} from 'node:fs';writeFileSync(" + new ObjectMapper().writeValueAsString(pid.toString())
                + ",String(process.pid));setInterval(()=>{},1000);");
        ApiException failure = assertTimeoutPreemptively(Duration.ofSeconds(15), () -> assertThrows(ApiException.class,
                () -> inspector.validate("x".repeat(900_000))));
        assertEquals("source_inspector_unavailable", failure.getCode());
        long child = Long.parseLong(Files.readString(pid));
        for (int attempt = 0; attempt < 100 && ProcessHandle.of(child).map(ProcessHandle::isAlive).orElse(false); attempt++) Thread.sleep(10);
        assertFalse(ProcessHandle.of(child).map(ProcessHandle::isAlive).orElse(false));
    }

    @Test void explicitlyBrokenRuntimeConfigurationDoesNotFallBackToADifferentScript() {
        var inspector = new SourceTargetInspector(new ObjectMapper(), root.resolve("missing").toString(), "", "node");
        assertEquals("source_inspector_unavailable", assertThrows(ApiException.class, () -> inspector.validate("const value=1")).getCode());
    }

    @Test void malformedSourceSpansCannotBeApplied() throws Exception {
        for (String output : java.util.List.of(
                "{ok:true,start:-1,end:10,code:'forged'}", "{ok:true,start:0,end:999,code:'forged'}",
                "{ok:true,start:0,end:1,code:'forged'}", "{ok:true,start:0.5,end:1,code:'x'}")) {
            var inspector = inspector("console.log(JSON.stringify(" + output + "))");
            assertEquals("source_target_invalid", assertThrows(ApiException.class, () -> inspector.inspect("x", 1, 1)).getCode());
        }
    }
}
