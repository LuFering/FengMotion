package com.fengmotion.server.common;

import static org.junit.jupiter.api.Assertions.*;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProcessOutputTest {
    @TempDir Path root;

    @Test void sparseLargeLogsAreReadOnlyAtTheTailAndResultsHaveAByteLimit() throws Exception {
        Path log = root.resolve("large.log");
        try (var file = new RandomAccessFile(log.toFile(), "rw")) {
            file.setLength(100_000_000);
            file.seek(99_999_996);
            file.writeBytes("tail");
        }
        assertEquals("tail", ProcessOutput.tail(log, 4));
        assertEquals("process_output_too_large", assertThrows(ApiException.class, () -> ProcessOutput.read(log, 1024)).getCode());
        Path unicode = Files.writeString(root.resolve("unicode.log"), "中文");
        assertEquals("中文", ProcessOutput.read(unicode, 6));
        assertThrows(ApiException.class, () -> ProcessOutput.read(unicode, 5));
        Path link = Files.createSymbolicLink(root.resolve("link.log"), unicode);
        assertThrows(java.io.IOException.class, () -> ProcessOutput.tail(link, 100));
    }
}
