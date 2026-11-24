package com.fengmotion.server.render.service;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;

class VideoTimelineProbeTest {
    @TempDir Path root;

    private VideoTimelineProbe probe(String output) throws Exception {
        Path script = root.resolve("probe.sh");
        Files.writeString(script, "#!/bin/sh\ncat <<'RESULT'\n" + output + "\nRESULT\n");
        Files.setPosixFilePermissions(script, PosixFilePermissions.fromString("rwx------"));
        return new VideoTimelineProbe(new ObjectMapper(), script.toString());
    }

    @Test void technicalVerificationRequiresActualDimensionsAndFrameCount() throws Exception {
        String matching = "{\"streams\":[{\"width\":640,\"height\":360,\"avg_frame_rate\":\"30/1\",\"duration\":\"2\",\"nb_frames\":\"60\"}]}";
        assertDoesNotThrow(() -> probe(matching).verify(root.resolve("video.mp4"), 60, 30, 640, 360));
        assertEquals("timeline_video_mismatch", assertThrows(ApiException.class,
                () -> probe(matching.replace("640", "1280")).verify(root.resolve("video.mp4"), 60, 30, 640, 360)).getCode());
        assertEquals("timeline_probe_failed", assertThrows(ApiException.class,
                () -> probe(matching.replace("\"60\"", "\"N/A\"")).verify(root.resolve("video.mp4"), 60, 30, 640, 360)).getCode());
    }
}
