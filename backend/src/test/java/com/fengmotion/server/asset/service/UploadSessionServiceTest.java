package com.fengmotion.server.asset.service;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.common.ApiException;

/**
 * 分片上传：续传、缺口拦截、内容完整性。
 *
 * <p>核心要验的不是「能上传」，而是<strong>分片拼出来的文件与原文逐字节一致</strong>，
 * 以及「中间少一片时不会拼出一个看似成功但内容错乱的文件」—— 后者是分片上传最危险的失败模式。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
class UploadSessionServiceTest {

    @Autowired
    private UploadSessionService sessions;

    @Autowired
    private AssetService assets;

    private static byte[] payload(int size) {
        byte[] data = new byte[size];
        for (int i = 0; i < size; i++) {
            data[i] = (byte) (i % 251);
        }
        return data;
    }

    @Test
    @DisplayName("按序写完所有分片后，合并文件与原文逐字节一致")
    void chunksAssembleIntoIdenticalFile() throws Exception {
        int total = UploadSessionService.CHUNK_SIZE_BYTES * 2 + 1000;
        byte[] data = payload(total);
        var session = sessions.create("big.bin", "application/octet-stream", total, null);
        int chunk = session.chunkSizeBytes();

        long offset = 0;
        int index = 0;
        while (offset < total) {
            int len = (int) Math.min(chunk, total - offset);
            byte[] part = java.util.Arrays.copyOfRange(data, (int) offset, (int) offset + len);
            sessions.writeChunk(session.uploadId(), index,
                    "bytes " + offset + "-" + (offset + len - 1) + "/" + total, part);
            offset += len;
            index++;
        }

        Path target = Files.createTempFile("assembled-", ".bin");
        try {
            var done = sessions.assemble(session.uploadId(), target);
            assertEquals(total, done.receivedBytes());
            assertEquals(total, Files.size(target));
            try (InputStream expected = new java.io.ByteArrayInputStream(data)) {
                assertArrayEquals(expected.readAllBytes(), Files.readAllBytes(target),
                        "分片拼接结果必须与原文一致");
            }
        } finally {
            Files.deleteIfExists(target);
        }
    }

    @Test
    @DisplayName("跳过分片会被拒绝，不会拼出内容错乱的文件")
    void gapBetweenChunksIsRejected() {
        int chunk = UploadSessionService.CHUNK_SIZE_BYTES;
        int total = chunk * 2;
        var session = sessions.create("gap.bin", "application/octet-stream", total, null);

        // 直接传第二片，起点不是 0，应当被拒。
        ApiException ex = assertThrows(ApiException.class, () -> sessions.writeChunk(
                session.uploadId(), 1, "bytes " + chunk + "-" + (chunk * 2 - 1) + "/" + total,
                new byte[chunk]));
        assertEquals("validation_error", ex.getCode());
        assertTrue(ex.getMessage().contains("不一致"), "错误要说清起点对不上");
    }

    @Test
    @DisplayName("Content-Range 声明的长度与实际分片不符时拒绝")
    void contentRangeLengthMismatchRejected() {
        var session = sessions.create("mismatch.bin", "application/octet-stream", 100, null);
        ApiException ex = assertThrows(ApiException.class, () -> sessions.writeChunk(
                session.uploadId(), 0, "bytes 0-49/100", new byte[10]));
        assertEquals("validation_error", ex.getCode());
    }

    @Test
    @DisplayName("未收完整就完成上传会被拒绝")
    void incompleteCannotComplete() {
        var session = sessions.create("partial.bin", "application/octet-stream", 100, null);
        sessions.writeChunk(session.uploadId(), 0, "bytes 0-9/100", new byte[10]);

        Path target = Path.of("target", "should-not-exist.bin");
        ApiException ex = assertThrows(ApiException.class, () -> sessions.assemble(session.uploadId(), target));
        assertEquals("validation_error", ex.getCode());
        assertTrue(ex.getMessage().contains("尚未接收完整"));
    }

    @Test
    @DisplayName("过期或未知会话返回 404，不静默新建")
    void unknownSessionIs404() {
        ApiException ex = assertThrows(ApiException.class, () -> sessions.get("upload_nope"));
        assertEquals("not_found", ex.getCode());
        assertEquals(404, ex.getStatus().value());
    }

    @Test
    @DisplayName("分片上传完成后能正常入库，与单请求上传走同一套规则")
    void completedUploadBecomesAsset() throws Exception {
        String content = "chunked-content";
        byte[] data = content.getBytes(StandardCharsets.UTF_8);
        var session = sessions.create("chunked.txt", "text/plain", data.length, null);
        sessions.writeChunk(session.uploadId(), 0,
                "bytes 0-" + (data.length - 1) + "/" + data.length, data);

        Path target = Files.createTempFile("chunked-", ".txt");
        try {
            sessions.assemble(session.uploadId(), target);
            Asset asset;
            try (InputStream in = Files.newInputStream(target)) {
                asset = assets.importFile("chunked.txt", "text/plain", null, null, in).asset();
            }
            assertEquals("chunked.txt", asset.name());
            assertEquals(data.length, asset.sizeBytes());
            // 入库后文件本体在素材库里，内容应与原始分片一致。
            Path stored = Path.of("target", "fengmotion-test-library")
                    .resolve(asset.fileUrl());
            assertEquals(content, Files.readString(stored));
        } finally {
            Files.deleteIfExists(target);
        }
    }
}
