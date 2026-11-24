package com.fengmotion.server.project.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.project.api.dto.ProjectDetail;

record ProjectContentSummary(long durationMs, int width, int height, double fps, ProjectDetail.Counts counts) {
    static ProjectContentSummary from(JsonNode film) {
        if (film == null || !film.isObject()) return empty();
        boolean rendered = "project-render".equals(film.path("kind").asText());
        JsonNode specification = rendered ? film.path("output") : film;
        int width = positiveInteger(specification.path("width"), 1920);
        int height = positiveInteger(specification.path("height"), 1080);
        double measuredFps = number(specification.path("fps"));
        boolean validFps = Double.isFinite(measuredFps) && measuredFps >= 1 && measuredFps <= 240;
        double fps = validFps ? measuredFps : 30;
        double frames = 0;
        JsonNode sceneItems = rendered ? film.path("shotTimeline").path("shots") : film.path("scenes");
        int sceneCount = sceneItems.isArray() ? sceneItems.size() : 0;
        if (rendered) {
            frames = number(specification.path("durationInFrames"));
            if (!Double.isFinite(frames) || frames != Math.rint(frames)) frames = 0;
        } else if (sceneItems.isArray()) {
            double seconds = 0;
            for (JsonNode scene : sceneItems) {
                double duration = number(scene.path("durationSeconds"));
                if (!Double.isFinite(duration) || duration <= 0) { seconds = Double.NaN; break; }
                seconds += duration;
            }
            frames = Double.isFinite(seconds) && seconds <= 36000 ? Math.round(seconds * fps) : 0;
        }
        double milliseconds = frames / fps * 1000;
        long durationMs = validFps && Double.isFinite(milliseconds) && milliseconds > 0 && milliseconds < Long.MAX_VALUE
                ? Math.round(milliseconds) : 0;
        int compositions = rendered && film.path("compositionId").isTextual() && !film.path("compositionId").asText().isBlank() ? 1 : 0;
        return new ProjectContentSummary(durationMs, width, height, fps,
                new ProjectDetail.Counts(sceneCount, 0, 0, compositions, 0));
    }

    private static double number(JsonNode value) { return value.isNumber() ? value.doubleValue() : Double.NaN; }

    private static int positiveInteger(JsonNode value, int fallback) {
        return value.isIntegralNumber() && value.canConvertToInt() && value.intValue() > 0 ? value.intValue() : fallback;
    }

    private static ProjectContentSummary empty() {
        return new ProjectContentSummary(0, 1920, 1080, 30, new ProjectDetail.Counts(0, 0, 0, 0, 0));
    }
}
