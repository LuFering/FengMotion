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
 * 会话及完成回执随分片原子落盘，进程重启后可按已确认字节续传；过期后清理。</p>
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
            String folderId,
            /** 完成上传后素材归属的项目；null 为未归属。 */
            String projectId) {
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
            String status,
            String projectId) {
    }

    private final Map<String, Stored> sessions = new ConcurrentHashMap<>();
    private final Map<String,AssetService.ImportResult> completed = new ConcurrentHashMap<>();
    private final Path chunkRoot;
    private final com.fasterxml.jackson.databind.ObjectMapper json=new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules();

    public UploadSessionService(
            @Value("${fengmotion.asset.library-root:${fengmotion.data-dir}/library}") String libraryRoot) {
        this.chunkRoot = Path.of(libraryRoot).toAbsolutePath().normalize().resolve(".uploads");
    }

    public Session create(String fileName, String mimeType, long sizeBytes, String folderId) {
        return create(fileName, mimeType, sizeBytes, folderId, null);
    }

    /** 带归属项目的会话；空串视为未归属。项目是否存在由调用方在建会话前校验。 */
    public synchronized Session create(String fileName, String mimeType, long sizeBytes, String folderId, String projectId) {
        reapExpired();
        if (fileName == null || fileName.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文件名不能为空");
        }
        if (sizeBytes <= 0 || sizeBytes>100L*1024*1024*1024) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文件大小必须在 1 字节至 100 GiB 之间");
        }
        if (folderId != null && folderId.isBlank()) {
            folderId = null;
        }
        if (projectId != null && projectId.isBlank()) {
            projectId = null;
        }
        String uploadId = "upload_" + UUID.randomUUID();
        Path dir = chunkRoot.resolve(uploadId);
        try {
            if(Files.isSymbolicLink(chunkRoot)) throw new IOException("invalid upload root");
            Files.createDirectories(dir);
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "无法创建上传目录");
        }
        Instant expiresAt = Instant.now().plusSeconds(SESSION_TTL_SECONDS);
        Stored stored = new Stored(uploadId, fileName, mimeType, sizeBytes, CHUNK_SIZE_BYTES, folderId, dir,
                expiresAt, 0, "created", projectId);
        persist(stored);
        sessions.put(uploadId, stored);
        return toSession(stored);
    }

    /** 读取会话（续传时客户端据此拿到权威的分片大小与已收字节）。 */
    public synchronized Session get(String uploadId) {
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
    public synchronized Session writeChunk(String uploadId, int index, String contentRange, byte[] data) {
        Stored stored = require(uploadId);
        if(stored.status().equals("completed")) throw new ApiException(HttpStatus.CONFLICT,"upload_completed","上传已完成");
        if(data==null || data.length==0 || data.length>stored.chunkSizeBytes() || index<0) throw new ApiException(HttpStatus.BAD_REQUEST,"validation_error","分片序号或大小无效");
        long[] range = parseContentRange(contentRange, data.length);
        long start = range[0];
        long end = range[1];
        if(index!=start/stored.chunkSizeBytes() || start%stored.chunkSizeBytes()!=0) throw new ApiException(HttpStatus.BAD_REQUEST,"validation_error","分片序号与范围不一致");
        if(range[2]>=0 && range[2]!=stored.sizeBytes()) throw new ApiException(HttpStatus.BAD_REQUEST,"validation_error","分片声明总大小不一致");
        if (end >= stored.sizeBytes()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "分片超出文件大小");
        }
        Path part = stored.chunkDir().resolve(String.format("part-%06d", index));
        if(start<stored.receivedBytes() && end<stored.receivedBytes()) {
            try {
                if(!Files.isSymbolicLink(part) && Files.size(part)==data.length && java.util.Arrays.equals(Files.readAllBytes(part),data)) return toSession(stored);
            } catch(IOException failure) { throw new ApiException(HttpStatus.CONFLICT,"upload_chunk_conflict","已收分片不可核对，请重新上传"); }
            throw new ApiException(HttpStatus.CONFLICT,"upload_chunk_conflict","该分片已接收且内容不同");
        }
        if (start != stored.receivedBytes()) {
            // 只接受紧接已收字节的分片：出现缺口就说明有分片没传成功，
            // 此时继续写入会拼出错误内容，不如明确要求重传该片。
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "分片起点与已接收字节不一致（期望 " + stored.receivedBytes() + "，收到 " + start + "）");
        }
        if(end+1<stored.sizeBytes() && data.length!=stored.chunkSizeBytes()) throw new ApiException(HttpStatus.BAD_REQUEST,"validation_error","非末尾分片必须使用服务端给定大小");
        try {
            if(Files.isSymbolicLink(stored.chunkDir()) || Files.isSymbolicLink(part)) throw new IOException("invalid chunk path");
            Path temporary=Files.createTempFile(stored.chunkDir(),".chunk-",".tmp");
            try { Files.write(temporary,data);Files.move(temporary,part,java.nio.file.StandardCopyOption.ATOMIC_MOVE,java.nio.file.StandardCopyOption.REPLACE_EXISTING); }
            finally { Files.deleteIfExists(temporary); }
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "分片写入失败");
        }
        long next = end + 1;
        Stored updated = new Stored(stored.uploadId(), stored.fileName(), stored.mimeType(), stored.sizeBytes(),
                stored.chunkSizeBytes(), stored.folderId(), stored.chunkDir(), stored.expiresAt(), next,
                "uploading", stored.projectId());
        persist(updated);
        sessions.put(uploadId, updated);
        return toSession(updated);
    }

    /**
     * 完成上传：把所有分片按序拼成完整文件。
     *
     * @param target 目标文件；已存在则覆盖
     */
    public synchronized Session assemble(String uploadId, Path target) {
        Stored stored = require(uploadId);
        if(Files.isSymbolicLink(stored.chunkDir())) throw new ApiException(HttpStatus.BAD_REQUEST,"validation_error","上传目录无效");
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
                    if (!Files.isRegularFile(part,java.nio.file.LinkOption.NOFOLLOW_LINKS)) {
                        throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                                "缺少分片 " + index + "，请重新上传");
                    }
                    long expected=Math.min(stored.chunkSizeBytes(),stored.sizeBytes()-written);
                    if(Files.size(part)!=expected) throw new ApiException(HttpStatus.CONFLICT,"upload_chunk_conflict","分片大小已改变，请重新上传");
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
                stored.receivedBytes(), "uploading", stored.projectId());
        persist(done);
        sessions.put(uploadId, done);
        return toSession(done);
    }

    public synchronized AssetService.ImportResult complete(String uploadId,AssetService assets) {
        Stored stored=require(uploadId);
        var previous=completed.get(uploadId);
        if(previous!=null) return finishCompletion(stored, previous);
        Path receipt=stored.chunkDir().resolve("completed.json");
        if(Files.exists(receipt,java.nio.file.LinkOption.NOFOLLOW_LINKS)) {
            try {
                if(Files.isSymbolicLink(receipt) || Files.size(receipt)>16384) throw new IOException("invalid upload receipt");
                var saved=json.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY,
                        com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(Files.readString(receipt));
                if(saved==null || !saved.isObject() || saved.path("assetId").asText().isBlank()) throw new IOException("invalid upload receipt");
                var result=new AssetService.ImportResult(assets.require(saved.path("assetId").asText()),saved.path("deduped").asBoolean());
                return finishCompletion(stored, result);
            } catch(IOException failure) { throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"upload_receipt_invalid","上传完成记录不可读取"); }
        }
        Path temporary=null;
        try {
            temporary=Files.createTempFile("fm-assembled-",".bin");
            assemble(uploadId,temporary);
            AssetService.ImportResult result;
            try(var input=Files.newInputStream(temporary)) {
                result=assets.importFile(stored.fileName(),stored.mimeType(),stored.folderId(),null,input,false,stored.projectId());
            }
            atomic(receipt,json.createObjectNode().put("assetId",result.asset().id()).put("deduped",result.deduped()).toString());
            return finishCompletion(stored, result);
        } catch(IOException failure) { throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR,"upload_complete_failed","上传合并失败，已收分片保留以便重试"); }
        finally { try { if(temporary!=null) Files.deleteIfExists(temporary); } catch(IOException ignored) { } }
    }

    private AssetService.ImportResult finishCompletion(Stored stored, AssetService.ImportResult result) {
        completed.put(stored.uploadId(), result);
        Stored done = new Stored(stored.uploadId(), stored.fileName(), stored.mimeType(), stored.sizeBytes(),
                stored.chunkSizeBytes(), stored.folderId(), stored.chunkDir(), stored.expiresAt(),
                stored.sizeBytes(), "completed", stored.projectId());
        sessions.put(stored.uploadId(), done);
        try {
            persist(done);
            try (var parts = Files.list(stored.chunkDir())) {
                for (Path part : parts.filter(path -> path.getFileName().toString().matches("part-\\d+")).toList()) {
                    Files.deleteIfExists(part);
                }
            }
        } catch (IOException | ApiException failure) {
            log.warn("素材已入库且完成回执已保存，上传状态收尾待重试：{}", stored.uploadId(), failure);
        }
        return result;
    }

    /** 取消上传并清理分片。 */
    public synchronized void cancel(String uploadId) {
        if(uploadId==null || !uploadId.matches("upload_[0-9a-f-]{36}")) throw new ApiException(HttpStatus.NOT_FOUND,"not_found","上传会话不存在");
        completed.remove(uploadId);
        sessions.remove(uploadId);
        cleanup(uploadId);
    }

    private void cleanup(String uploadId) {
        Stored stored = sessions.get(uploadId);
        Path dir = stored == null ? chunkRoot.resolve(uploadId) : stored.chunkDir();
        try {
            if(Files.isSymbolicLink(chunkRoot) || Files.isSymbolicLink(dir)) return;
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
        if(uploadId==null || !uploadId.matches("upload_[0-9a-f-]{36}")) throw new ApiException(HttpStatus.NOT_FOUND,"not_found","上传会话不存在");
        if (Files.isSymbolicLink(chunkRoot) || Files.isSymbolicLink(chunkRoot.resolve(uploadId))) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "upload_session_invalid", "上传会话目录不能使用符号链接");
        }
        Stored stored = sessions.get(uploadId);
        if(stored==null) {
            Path directory=chunkRoot.resolve(uploadId);
            Path file=directory.resolve("session.json");
            if(Files.isRegularFile(file,java.nio.file.LinkOption.NOFOLLOW_LINKS)) {
                try {
                    if(Files.isSymbolicLink(chunkRoot) || Files.isSymbolicLink(directory) || Files.size(file)>16384) throw new IOException("invalid session path");
                    Session saved=json.readValue(Files.readString(file),Session.class);
                    if(saved==null || !uploadId.equals(saved.uploadId()) || saved.chunkSizeBytes()!=CHUNK_SIZE_BYTES || saved.sizeBytes()<=0
                            || saved.sizeBytes()>100L*1024*1024*1024 || saved.receivedBytes()<0 || saved.receivedBytes()>saved.sizeBytes()
                            || saved.expiresAt()==null || saved.status()==null || !java.util.List.of("created","uploading","completed").contains(saved.status())
                            || saved.fileName()==null || saved.fileName().isBlank()) throw new IOException("invalid session data");
                    stored=new Stored(uploadId,saved.fileName(),saved.mimeType(),saved.sizeBytes(),saved.chunkSizeBytes(),saved.folderId(),directory,saved.expiresAt(),saved.receivedBytes(),saved.status(),saved.projectId());
                    sessions.put(uploadId,stored);
                } catch(IOException failure) { throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"upload_session_invalid","上传会话记录无效，分片保留供核对"); }
            }
        }
        if (stored == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "上传会话不存在或已过期");
        }
        if (Instant.now().isAfter(stored.expiresAt())) {
            sessions.remove(uploadId);
            completed.remove(uploadId);
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
            long total=-1;
            if(slash>=0 && !value.substring(slash+1).trim().equals("*")) {
                total=Long.parseLong(value.substring(slash+1).trim());
                if(total<=0 || end>=total) throw new NumberFormatException("invalid total");
            }
            return new long[] {start, end,total};
        } catch (NumberFormatException ex) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "Content-Range 格式无效");
        }
    }

    private static Session toSession(Stored stored) {
        return new Session(stored.uploadId(), stored.fileName(), stored.mimeType(), stored.sizeBytes(),
                stored.chunkSizeBytes(), stored.receivedBytes(), stored.status(), stored.expiresAt(),
                stored.folderId(), stored.projectId());
    }

    /** 供合并时让调用方拿到会话里的元数据。 */
    public synchronized Session sessionOf(String uploadId) {
        return toSession(require(uploadId));
    }

    @org.springframework.scheduling.annotation.Scheduled(fixedDelay=60000)
    public synchronized void reapExpired() {
        if(Files.isDirectory(chunkRoot,java.nio.file.LinkOption.NOFOLLOW_LINKS)) {
            try(var paths=Files.list(chunkRoot)) {
                for(Path path:paths.toList()) {
                    String id=path.getFileName().toString();
                    if(!id.matches("upload_[0-9a-f-]{36}") || sessions.containsKey(id) || Files.isSymbolicLink(path)) continue;
                    try { require(id); } catch(ApiException failure) {
                        if(!failure.getCode().equals("not_found")) log.warn("上传会话无法恢复：{}",id);
                    }
                }
            } catch(IOException failure) { log.warn("上传会话扫描失败",failure); }
        }
        for(var entry:java.util.List.copyOf(sessions.entrySet())) {
            if(Instant.now().isAfter(entry.getValue().expiresAt())) cancel(entry.getKey());
        }
    }

    private void persist(Stored stored) {
        try { atomic(stored.chunkDir().resolve("session.json"),json.writeValueAsString(toSession(stored))); }
        catch(IOException failure) { throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR,"upload_state_failed","上传状态无法保存，请重试当前分片"); }
    }

    private void atomic(Path target,String text) throws IOException {
        Path temporary=Files.createTempFile(target.getParent(),".upload-state-",".tmp");
        try {
            Files.writeString(temporary,text);
            Files.move(temporary,target,java.nio.file.StandardCopyOption.ATOMIC_MOVE,java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temporary); }
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
