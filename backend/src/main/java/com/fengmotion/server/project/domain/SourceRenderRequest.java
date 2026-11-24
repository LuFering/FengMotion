package com.fengmotion.server.project.domain;

import org.springframework.http.HttpStatus;
import com.fengmotion.server.common.ApiException;

public record SourceRenderRequest(String requestId, Long baseVersion, String sourceHash, String prompt) {
    public void validate() {
        if (requestId == null || !requestId.matches("[a-zA-Z0-9_-]{1,128}") || baseVersion == null || baseVersion < 0
                || sourceHash == null || !sourceHash.matches("files=\\d+;sha256=(?:[0-9a-f]{64}|empty)")
                || (prompt != null && prompt.length() > 4000)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "出片需要有效的 requestId、baseVersion 和 sourceHash；prompt 最多 4000 字符");
        }
    }
}
