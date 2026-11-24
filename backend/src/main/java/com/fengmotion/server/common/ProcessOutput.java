package com.fengmotion.server.common;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

import org.springframework.http.HttpStatus;

public final class ProcessOutput {
    private ProcessOutput() { }

    public static String read(Path file, int maxBytes) throws IOException {
        if (maxBytes < 1) throw new IllegalArgumentException("maxBytes must be positive");
        try (var input = java.nio.file.Files.newInputStream(file, LinkOption.NOFOLLOW_LINKS)) {
            byte[] bytes = input.readNBytes(maxBytes + 1);
            if (bytes.length > maxBytes) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "process_output_too_large", "工具结果超过允许大小，未作为成功结果提交");
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }

    public static String tail(Path file, int maxBytes) throws IOException {
        if (maxBytes < 1) throw new IllegalArgumentException("maxBytes must be positive");
        try (var channel = FileChannel.open(file, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
            long size = channel.size();
            channel.position(Math.max(0, size - maxBytes));
            ByteBuffer buffer = ByteBuffer.allocate((int) Math.min(size, maxBytes));
            while (buffer.hasRemaining() && channel.read(buffer) > 0) { }
            return new String(buffer.array(), 0, buffer.position(), StandardCharsets.UTF_8);
        }
    }
}
