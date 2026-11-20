package com.fengmotion.server.project.domain;

public record ShotCandidateRequest(Long baseVersion, String sourceHash, String shotId,
                                   String componentSource, String prompt, String requestId) {
}
