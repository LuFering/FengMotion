package com.fengmotion.server.creation.domain;

public interface CreationSessionAccess {
    void validate(String projectId, String sessionId, String userMessageId);

    void saveReply(String sessionId, String userMessageId, String requestId, String reply);
}
