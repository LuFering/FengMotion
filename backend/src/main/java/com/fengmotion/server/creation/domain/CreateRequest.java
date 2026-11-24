package com.fengmotion.server.creation.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fengmotion.server.harness.client.NativeHarnesses;

public record CreateRequest(String intent, JsonNode references, String previewImage, Long baseVersion,
                            String correction, String requestId, String sessionId, String userMessageId,
                            String harness, String model, String reasoningEffort, JsonNode workflow,
                            @JsonInclude(JsonInclude.Include.NON_NULL) String filmFormat,
                            @JsonInclude(JsonInclude.Include.NON_NULL) String outputMode,
                            @JsonInclude(JsonInclude.Include.NON_NULL) String sourceHash,
                            @JsonInclude(JsonInclude.Include.NON_NULL) com.fengmotion.server.project.domain.SourceTarget target) {
    public CreateRequest(String intent, JsonNode references, String previewImage, Long baseVersion,
                         String correction, String requestId, String sessionId, String userMessageId,
                         String harness, String model, String reasoningEffort, JsonNode workflow, String filmFormat, String outputMode) {
        this(intent, references, previewImage, baseVersion, correction, requestId, sessionId,
                userMessageId, harness, model, reasoningEffort, workflow, filmFormat, outputMode, null, null);
    }
    public CreateRequest(String intent, JsonNode references, String previewImage, Long baseVersion,
                         String correction, String requestId, String sessionId, String userMessageId,
                         String harness, String model, String reasoningEffort, JsonNode workflow, String filmFormat) {
        this(intent, references, previewImage, baseVersion, correction, requestId, sessionId,
                userMessageId, harness, model, reasoningEffort, workflow, filmFormat, null);
    }

    public boolean draftOnly() { return "draft".equals(outputMode); }

    public void validateOutputMode() {
        if ((target != null || sourceHash != null) && (!draftOnly() || baseVersion == null || baseVersion < 0
                || sourceHash == null || !sourceHash.matches("files=\\d+;sha256=(?:[0-9a-f]{64}|empty)"))) {
            throw new com.fengmotion.server.common.ApiException(org.springframework.http.HttpStatus.BAD_REQUEST,
                    "validation_error", "源码目标修改需要 draft 模式、baseVersion 和 sourceHash");
        }
        if (outputMode != null && !"draft".equals(outputMode) && !"render".equals(outputMode)) {
            throw new com.fengmotion.server.common.ApiException(org.springframework.http.HttpStatus.BAD_REQUEST,
                    "validation_error", "outputMode 只能是 draft 或 render");
        }
        if (draftOnly() && filmFormat != null) {
            throw new com.fengmotion.server.common.ApiException(org.springframework.http.HttpStatus.BAD_REQUEST,
                    "validation_error", "首次镜头制作不能使用 draft 输出模式");
        }
    }
    public CreateRequest(String intent, JsonNode references, String previewImage, Long baseVersion,
                         String correction, String requestId, String sessionId, String userMessageId,
                         String harness, String model, String reasoningEffort, JsonNode workflow) {
        this(intent, references, previewImage, baseVersion, correction, requestId, sessionId,
                userMessageId, harness, model, reasoningEffort, workflow, null);
    }
    public CreateRequest(String intent, JsonNode references, String previewImage, Long baseVersion,
                         String correction, String requestId, String sessionId, String userMessageId,
                         String harness, String model, String reasoningEffort) {
        this(intent, references, previewImage, baseVersion, correction, requestId, sessionId, userMessageId,
                harness, model, reasoningEffort, null);
    }

    public NativeHarnesses.Selection engineSelection() {
        return harness == null && model == null && reasoningEffort == null ? null
                : new NativeHarnesses.Selection(harness, model, reasoningEffort);
    }
}
