package com.fengmotion.server.asset.service;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ThumbnailCancellationTest {
    @TempDir Path root;
    @Test void interruptedProbeDoesNotLeaveItsProcessRunning() throws Exception {
        Path pid=root.resolve("pid");
        Path script=Files.writeString(root.resolve("probe.sh"),"#!/bin/sh\necho $$ > '"+pid+"'\nexec sleep 60\n");
        assertTrue(script.toFile().setExecutable(true));
        var service=new ThumbnailService(script.toString(),script.toString());
        Path input=Files.writeString(root.resolve("input.mp4"),"fixture");
        try(var executor=Executors.newSingleThreadExecutor()) {
            var pending=executor.submit(()->service.probe(input));
            for(int attempt=0;attempt<100&&!Files.exists(pid);attempt++)Thread.sleep(10);
            assertTrue(Files.exists(pid));
            long process=Long.parseLong(Files.readString(pid).trim());
            pending.cancel(true);
            for(int attempt=0;attempt<100&&ProcessHandle.of(process).map(ProcessHandle::isAlive).orElse(false);attempt++)Thread.sleep(10);
            assertFalse(ProcessHandle.of(process).map(ProcessHandle::isAlive).orElse(false));
        }
    }
}
