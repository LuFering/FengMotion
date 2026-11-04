package com.fengmotion.server.asset.api;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.asset.api.dto.AssetResponse;
import com.fengmotion.server.asset.service.AssetService;
import com.fengmotion.server.asset.service.UploadSessionService;
import com.fengmotion.server.common.ApiException;

/**
 * 分片上传（契约 asset.md §3.2）。
 *
 * <p>素材库的真实对象是几百 MB 的视频，单请求上传中断就要从头再来。分片上传让客户端
 * 能按服务端确认的 {@code receivedBytes} 续传。</p>
 *
 * <p>分片大小由服务端在会话里给出，客户端必须照用：这样续传时两边算出的分片边界一致。
 * 服务端还校验 {@code Content-Range} 的起点必须紧接已收字节 —— 出现缺口说明中间有片没传成，
 * 此时继续拼会得到内容错乱的文件，不如明确要求重传该片。</p>
 */
@RestController
@RequestMapping("/api/assets/uploads")
public class AssetUploadController {

    private final UploadSessionService sessions;
    private final AssetService assets;
    private final AssetResponses responses;

    public AssetUploadController(UploadSessionService sessions, AssetService assets, AssetResponses responses) {
        this.sessions = sessions;
        this.assets = assets;
        this.responses = responses;
    }

    /** 建会话，返回权威的分片大小与过期时间。 */
    @PostMapping
    public ResponseEntity<SessionResponse> create(@RequestBody CreateSessionRequest request) {
        if (request == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "请求体不能为空");
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(
                SessionResponse.of(sessions.create(request.fileName(), request.mimeType(),
                        request.sizeBytes() == null ? 0 : request.sizeBytes(), request.folderId())));
    }

    /** 读会话；续传时客户端据此拿到已确认字节数。 */
    @GetMapping("/{uploadId}")
    public SessionResponse get(@PathVariable String uploadId) {
        return SessionResponse.of(sessions.get(uploadId));
    }

    /**
     * 写一片。
     *
     * <p>分片以原始二进制提交（{@code application/octet-stream}），范围由 {@code Content-Range} 声明。</p>
     */
    @PutMapping("/{uploadId}/chunks/{index}")
    public SessionResponse writeChunk(@PathVariable String uploadId,
            @PathVariable int index,
            @RequestHeader(value = "Content-Range", required = false) String contentRange,
            @RequestBody byte[] data) {
        return SessionResponse.of(sessions.writeChunk(uploadId, index, contentRange,
                data == null ? new byte[0] : data));
    }

    /**
     * 完成上传：合并分片并按正常流程入库。
     *
     * <p>合并后走的是与单请求上传完全相同的 {@code importFile}，所以去重、类型校验、
     * 状态初始化这些规则只有一份实现。</p>
     */
    @PostMapping("/{uploadId}/complete")
    public ResponseEntity<AssetController.UploadResponse> complete(@PathVariable String uploadId) {
        UploadSessionService.Session session = sessions.sessionOf(uploadId);
        Path tmp;
        try {
            tmp = Files.createTempFile("fengmotion-assembled-", ".bin");
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "无法创建临时文件");
        }
        try {
            UploadSessionService.Session assembled = sessions.assemble(uploadId, tmp);
            try (InputStream in = Files.newInputStream(tmp)) {
                AssetService.ImportResult result = assets.importFile(session.fileName(), session.mimeType(),
                        assembled.folderId(), null, in);
                return ResponseEntity.status(HttpStatus.CREATED)
                        .body(new AssetController.UploadResponse(responses.of(result.asset(), true),
                                result.deduped()));
            }
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "读取合并结果失败");
        } finally {
            try {
                Files.deleteIfExists(tmp);
            } catch (IOException ignored) {
                // 临时文件清理失败不影响上传结果。
            }
        }
    }

    /** 取消上传，清理已收分片。 */
    @DeleteMapping("/{uploadId}")
    public ResponseEntity<Void> cancel(@PathVariable String uploadId) {
        sessions.cancel(uploadId);
        return ResponseEntity.noContent().build();
    }

    /** 建会话请求（契约 asset.md §3.2）。 */
    public record CreateSessionRequest(String fileName, String mimeType, Long sizeBytes, String folderId) {
    }

    /**
     * 会话响应。
     *
     * <p>字段名刻意与客户端解析逻辑对齐（{@code receivedBytes}/{@code chunkSizeBytes} 在顶层），
     * 客户端按最保守方式认三种形状，顶层命中就不必再下钻。</p>
     */
    public record SessionResponse(
            String uploadId,
            String fileName,
            String mimeType,
            long sizeBytes,
            int chunkSizeBytes,
            long receivedBytes,
            String status,
            String expiresAt,
            String folderId) {

        static SessionResponse of(UploadSessionService.Session session) {
            return new SessionResponse(session.uploadId(), session.fileName(), session.mimeType(),
                    session.sizeBytes(), session.chunkSizeBytes(), session.receivedBytes(), session.status(),
                    session.expiresAt().toString(), session.folderId());
        }
    }
}
