package com.fengmotion.server.project.domain;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

public record SceneEditMetadata(String projectId, long version, String artifactPath, String sourceHash,
                                String status, Reason reason, List<Element> elements) {
    public static SceneEditMetadata declared(ProjectSceneVersion version, String sourceHash, List<Element> elements) {
        return new SceneEditMetadata(version.projectId(), version.version(), version.artifactPath(), sourceHash,
                "declared", null, List.copyOf(elements));
    }

    public static SceneEditMetadata previewOnly(ProjectSceneVersion version, String code, String message) {
        return new SceneEditMetadata(version.projectId(), version.version(), version.artifactPath(), null,
                "preview_only", new Reason(code, message), List.of());
    }

    public record Reason(String code, String message) { }

    public record Element(String id, String kind, String label, TextProperties properties,
                          @JsonInclude(JsonInclude.Include.NON_NULL) Placement placement) { }

    public record TextProperties(String text) { }

    public record Placement(int startFrame, int endFrame, Bounds bounds) { }

    public record Bounds(double x, double y, double w, double h) { }
}
