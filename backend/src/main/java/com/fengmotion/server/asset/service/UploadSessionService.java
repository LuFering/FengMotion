package com.fengmotion.server.asset.service;

import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fengmotion.server.common.ApiException;

/**
 * 分片上传会话（契约 asset.md §3.2）。
 *
 * <p>为什么除了单请求上传还要有分片：素材库的真实对象是几百 MB 的视频，
 * 一次 multipart 请求中断就得从头再来，而分片可以按服务端已确认的字节数续传。
 * 会话状态放在内存里而不是数据库：上传会话是几分钟级的瞬态，进程重启后重建会话
 * 比让用户面对一堆「上次上传到一半」的孤儿记录更好。</p>
 *
 * <p><strong>分片大小由服务端决定并回传</strong>，客户端不得自定（契约 §3.2 与 README §2.8）。
 * 这样续传时「从第几片开始」两边算出来的边界才一致。</p>
 */
@Service
public class UploadSessionService {

    private static final Logger log = LoggerFactory.getLogger(UploadSessionService.class);

    /** 单个分片的字节数。8 MiB 在 100 Mbps 网络上约 0.7 秒一片，重传代价可接受。 */
    static final int CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

    /** 会话有效期；过期后分片目录清理，客户端必须重建会话。 */
    static final long SESSION_TTL_SECONDS = 3600;

    /** 一个上传会话。 */
    public record Session(
            String uploadId,
            String fileName,
            String mimeType,
            long sizeBytes,
            int chunkSizeBytes,
            long receivedBytes,
            String status,
            Instant expiresAt,
            String folderId) {
    }

    private record Stored(
            String uploadId,
            String fileName,
            String mimeType,
            long sizeBytes,
            int chunkSizeBytes,
            String folderId,
            Path chunkDir,
            Instant expiresAt,
            /** 已确认连续收到的字节数；分片必须按序推进，避免空洞。 */
            long receivedBytes,
            String status) {
    }

    private final Map<String, Stored> sessions = new ConcurrentHashMap<>();
    private final Path chunkRoot;

    public UploadSessionService(
            @Value("${fengmotion.asset.library-root:${fengmotion.data-dir}/library}") String libraryRoot) {
        this.chunkRoot = Path.of(libraryRoot).toAbsolutePath().normalize().resolve(".uploads");
    }

    public Session create(String fileName, String mimeType, long sizeBytes, String folderId) {
        if (fileName == null || fileName.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文件名不能为空");
        }
        if (sizeBytes <= 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文件大小必须大于 0");
        }
        if (folderId != null && folderId.isBlank()) {
            folderId = null;
        }
        String uploadId = "upload_" + UUID.randomUUID();
        Path dir = chunkRoot.resolve(uploadId);
        try {
            Files.createDirectories(dir);
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "无法创建上传目录");
        }
        Instant expiresAt = Instant.now().plusSeconds(SESSION_TTL_SECONDS);
        Stored stored = new Stored(uploadId, fileName, mimeType, sizeBytes, CHUNK_SIZE_BYTES, folderId, dir,
                expiresAt, 0, "created");
        sessions.put(uploadId, stored);
        return toSession(stored);
    }

    /** 读取会话（续传时客户端据此拿到权威的分片大小与已收字节）。 */
    public Session get(String uploadId) {
        return toSession(require(uploadId));
    }

    /**
     * 写入一个分片。
     *
     * <p>{@code contentRange} 形如 {@code bytes 0-8388607/104857600}。解析它而不是相信
     * 分片序号：客户端若把序号和范围算错，按序号落盘会拼出内容错乱的文件，
     * 而按范围写入至少能发现「缺口」。</p>
     *
     * @return 写入后的会话
     */
    public Session writeChunk(String uploadId, int index, String contentRange, byte[] data) {
        Stored stored = require(uploadId);
        long[] range = parseContentRange(contentRange, data.length);
        long start = range[0];
        long end = range[1];
        if (end >= stored.sizeBytes()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "分片超出文件大小");
        }
        if (start != stored.receivedBytes()) {
            // 只接受紧接已收字节的分片：出现缺口就说明有分片没传成功，
            // 此时继续写入会拼出错误内容，不如明确要求重传该片。
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "分片起点与已接收字节不一致（期望 " + stored.receivedBytes() + "，收到 " + start + "）");
        }
        Path part = stored.chunkDir().resolve(String.format("part-%06d", index));
        try {
            Files.write(part, data);
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "分片写入失败");
        }
        long next = end + 1;
        Stored updated = new Stored(stored.uploadId(), stored.fileName(), stored.mimeType(), stored.sizeBytes(),
                stored.chunkSizeBytes(), stored.folderId(), stored.chunkDir(), stored.expiresAt(), next,
                "uploading");
        sessions.put(uploadId, updated);
        return toSession(updated);
    }

    /**
     * 完成上传：把所有分片按序拼成完整文件。
     *
     * @param target 目标文件；已存在则覆盖
     */
    public Session assemble(String uploadId, Path target) {
        Stored stored = require(uploadId);
        if (stored.receivedBytes() != stored.sizeBytes()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "文件尚未接收完整（已收 " + stored.receivedBytes() + " / " + stored.sizeBytes() + "）");
        }
        try {
            Files.createDirectories(target.getParent());
            try (OutputStream out = Files.newOutputStream(target)) {
                long written = 0;
                while (written < stored.sizeBytes()) {
                    long index = written / stored.chunkSizeBytes();
                    Path part = stored.chunkDir().resolve(String.format("part-%06d", index));
                    if (!Files.exists(part)) {
                        throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                                "缺少分片 " + index + "，请重新上传");
                    }
                    byte[] data = Files.readAllBytes(part);
                    out.write(data);
                    written += data.length;
                }
            }
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "合并分片失败");
        }
        Stored done = new Stored(stored.uploadId(), stored.fileName(), stored.mimeType(), stored.sizeBytes(),
                stored.chunkSizeBytes(), stored.folderId(), stored.chunkDir(), stored.expiresAt(),
                stored.receivedBytes(), "completed");
        sessions.put(uploadId, done);
        cleanup(uploadId);
        return toSession(done);
    }

    /** 取消上传并清理分片。 */
    public void cancel(String uploadId) {
        Stored stored = sessions.remove(uploadId);
        if (stored != null) {
            cleanup(uploadId);
        }
    }

    private void cleanup(String uploadId) {
        Stored stored = sessions.get(uploadId);
        Path dir = stored == null ? chunkRoot.resolve(uploadId) : stored.chunkDir();
        try {
            if (Files.exists(dir)) {
                try (var walk = Files.walk(dir)) {
                    for (Path path : walk.sorted(java.util.Comparator.reverseOrder()).toList()) {
                        Files.deleteIfExists(path);
                    }
                }
            }
        } catch (IOException ex) {
            log.warn("清理上传分片失败：{}", uploadId, ex);
        }
    }

    private Stored require(String uploadId) {
        Stored stored = sessions.get(uploadId);
        if (stored == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "上传会话不存在或已过期");
        }
        if (Instant.now().isAfter(stored.expiresAt())) {
            sessions.remove(uploadId);
            cleanup(uploadId);
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "上传会话已过期，请重新上传");
        }
        return stored;
    }

    /**
     * 解析 {@code Content-Range}。
     *
     * <p>支持两种常见写法：{@code bytes 0-1023/4096} 与 {@code bytes 0-1023/*}。
     * 解析失败直接 400：把范围猜错会让分片拼错，比拒绝更糟。</p>
     */
    private static long[] parseContentRange(String header, int dataLength) {
        if (header == null || header.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "缺少 Content-Range");
        }
        String value = header.trim().toLowerCase();
        if (value.startsWith("bytes ")) {
            value = value.substring("bytes ".length()).trim();
        }
        int slash = value.indexOf('/');
        String rangePart = slash >= 0 ? value.substring(0, slash) : value;
        int dash = rangePart.indexOf('-');
        if (dash <= 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "Content-Range 格式无效");
        }
        try {
            long start = Long.parseLong(rangePart.substring(0, dash).trim());
            long end = Long.parseLong(rangePart.substring(dash + 1).trim());
            if (start < 0 || end < start) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "Content-Range 区间无效");
            }
            if (end - start + 1 != dataLength) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                        "Content-Range 声明的长度与实际分片大小不一致");
            }
            return new long[] {start, end};
        } catch (NumberFormatException ex) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "Content-Range 格式无效");
        }
    }

    private static Session toSession(Stored stored) {
        return new Session(stored.uploadId(), stored.fileName(), stored.mimeType(), stored.sizeBytes(),
                stored.chunkSizeBytes(), stored.receivedBytes(), stored.status(), stored.expiresAt(),
                stored.folderId());
    }

    /** 供合并时让调用方拿到会话里的元数据。 */
    public Session sessionOf(String uploadId) {
        return toSession(require(uploadId));
    }

    /** 读一个已合并文件的大小，用于测试与诊断。 */
    static long fileSize(Path path) {
        try (RandomAccessFile file = new RandomAccessFile(path.toFile(), "r")) {
            return file.length();
        } catch (IOException ex) {
            return -1;
        }
    }
}
