package com.fengmotion.server.creation.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fengmotion.server.harness.client.NativeHarnesses;

public record CreateRequest(String intent, JsonNode references, String previewImage, Long baseVersion,
                            String correction, String requestId, String sessionId, String userMessageId,
                            String harness, String model, String reasoningEffort, JsonNode workflow,
                            @JsonInclude(JsonInclude.Include.NON_NULL) String filmFormat) {
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
