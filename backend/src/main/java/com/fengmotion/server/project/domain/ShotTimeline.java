package com.fengmotion.server.project.domain;

import java.util.List;

public record ShotTimeline(int width, int height, int fps, int durationInFrames,
                           List<Shot> shots, String voiceover) {
    public static final String FORMAT = "shot-timeline-v1";
    public static final String ENTRY = ".fengmotion-shot-entry.tsx";
    public static final String COMPOSITION = "FengMotionShots";

    public record Shot(String id, String sourceId, String label, int startFrame, int frames) { }
}
