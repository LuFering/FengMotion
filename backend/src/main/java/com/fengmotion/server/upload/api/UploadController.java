package com.fengmotion.server.upload.api;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.fengmotion.server.upload.domain.UploadedFile;
import com.fengmotion.server.upload.service.UploadService;

import lombok.RequiredArgsConstructor;

/**
 * 附件上传端点。
 *
 * <p>契约（{@code upload/package-info.java}）：{@code POST /api/uploads}，multipart，
 * 返回 {@code { fileId, name, size, kind }}。响应里**不含**落盘路径与绝对目录，
 * 调用方只拿 {@code fileId} 去引用。</p>
 */
@RestController
@RequestMapping("/api/uploads")
@RequiredArgsConstructor
public class UploadController {

    private final UploadService uploads;

    /**
     * 上传一个附件。
     *
     * @param file multipart 字段 {@code file}
     * @return 201 与附件描述
     */
    @PostMapping
    public ResponseEntity<UploadResponse> upload(@RequestParam("file") MultipartFile file) {
        UploadedFile stored = uploads.store(file);
        return ResponseEntity.status(HttpStatus.CREATED).body(UploadResponse.from(stored));
    }

    /**
     * 上传结果。
     *
     * <p>只暴露契约要求的四个字段：{@code fileId} / {@code name} / {@code size} / {@code kind}。
     * {@code mimeType} 与 {@code sha256} 给前端做类型判断与去重；不含路径。</p>
     *
     * @param fileId   附件标识，后续用它在消息里引用
     * @param name     原始文件名（仅展示）
     * @param size     字节数
     * @param kind     image / video / audio / file
     * @param mimeType 规范化后的 MIME
     * @param sha256   内容摘要
     */
    public record UploadResponse(
            String fileId,
            String name,
            long size,
            String kind,
            String mimeType,
            String sha256) {

        /**
         * 由领域对象转换。
         *
         * @param file 已落盘的附件
         * @return 响应体
         */
        static UploadResponse from(UploadedFile file) {
            return new UploadResponse(
                    file.id(), file.name(), file.sizeBytes(), file.kind(), file.mimeType(), file.sha256());
        }
    }
}
