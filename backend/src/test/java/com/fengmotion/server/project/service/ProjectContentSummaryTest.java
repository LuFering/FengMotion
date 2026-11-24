package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ProjectContentSummaryTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test void measuredRenderPreservesFractionalFpsWithoutInventingSceneOrReviewCounts() throws Exception {
        var summary = ProjectContentSummary.from(json.readTree("""
                {"kind":"project-render","compositionId":"Main",
                 "output":{"durationInFrames":900,"fps":29.97,"width":960,"height":540}}
                """));
        assertEquals(30030, summary.durationMs());
        assertEquals(29.97, summary.fps());
        assertEquals(960, summary.width());
        assertEquals(540, summary.height());
        assertEquals(0, summary.counts().scenes());
        assertEquals(0, summary.counts().doneScenes());
        assertEquals(1, summary.counts().compositions());
    }

    @Test void legacyScenesUseCompositionFrameRounding() throws Exception {
        var summary = ProjectContentSummary.from(json.readTree("""
                {"width":640,"height":360,"fps":30,"scenes":[{"durationSeconds":0.05},{"durationSeconds":0.05}]}
                """));
        assertEquals(100, summary.durationMs());
        assertEquals(2, summary.counts().scenes());
        assertEquals(0, summary.counts().doneScenes());
    }

    @Test void shotTimelineCountsKnownInstancesNotGuessedDomElements() throws Exception {
        var summary = ProjectContentSummary.from(json.readTree("""
                {"kind":"project-render","output":{"durationInFrames":60,"fps":30},
                 "shotTimeline":{"shots":[{"id":"intro"},{"id":"outro"}]}}
                """));
        assertEquals(2000, summary.durationMs());
        assertEquals(2, summary.counts().scenes());
        assertEquals(0, summary.counts().timelineClips());
    }

    @Test void missingAndInvalidTimingDoesNotProduceAFictionalDuration() throws Exception {
        for (String value : java.util.List.of("null", "[]", "{}",
                "{\"kind\":\"project-render\",\"output\":{\"durationInFrames\":60,\"fps\":0}}",
                "{\"fps\":30,\"scenes\":[{\"durationSeconds\":-1}]}")) {
            assertEquals(0, ProjectContentSummary.from(json.readTree(value)).durationMs());
        }
    }
}
