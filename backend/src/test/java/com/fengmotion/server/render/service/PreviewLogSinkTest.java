package com.fengmotion.server.render.service;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PreviewLogSinkTest {
    @TempDir Path root;

    @Test void noisyChildIsDrainedWithoutGrowingLogsOrBlockingItsExit() throws Exception {
        Path stdout = root.resolve("stdout.log");
        Path stderr = root.resolve("stderr.log");
        var child = new ProcessBuilder("node", "-e", "console.log('ready');process.stdout.write('x'.repeat(2000000));process.stderr.write('y'.repeat(2000000));").start();
        try (var out = PreviewLogSink.start(child.getInputStream(), stdout, 16384);
             var err = PreviewLogSink.start(child.getErrorStream(), stderr, 16384)) {
            assertTrue(child.waitFor(5, TimeUnit.SECONDS));
            assertEquals(0, child.exitValue());
            for (int attempt = 0; attempt < 100 && Files.size(stderr) < 16384; attempt++) Thread.sleep(10);
            assertEquals(16384, Files.size(stdout));
            assertEquals(16384, Files.size(stderr));
            assertTrue(Files.readString(stdout).startsWith("ready\n"));
        } finally { child.destroyForcibly(); }
    }
}
