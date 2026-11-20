package com.fengmotion.server.render.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;

@Component
public class VideoTimelineProbe {
    private final ObjectMapper json;
    private final String binary;

    public VideoTimelineProbe(ObjectMapper json, @Value("${fengmotion.asset.ffprobe:ffprobe}") String binary) {
        this.json = json;
        this.binary = binary;
    }

    public void verify(Path video, int frames, double fps) {
        Path output = null;
        Process process = null;
        try {
            output = Files.createTempFile("fm-timeline-probe-", ".json");
            process = new ProcessBuilder(binary, "-v", "error", "-select_streams", "v:0",
                    "-show_entries", "stream=avg_frame_rate,duration,nb_frames", "-of", "json", video.toString())
                    .redirectOutput(output.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD).start();
            if (!process.waitFor(30, TimeUnit.SECONDS) || process.exitValue() != 0) throw unavailable();
            var stream = json.readTree(output.toFile()).path("streams").path(0);
            String[] ratio = stream.path("avg_frame_rate").asText("").split("/");
            double actualFps = ratio.length == 2 ? Double.parseDouble(ratio[0]) / Double.parseDouble(ratio[1]) : 0;
            double seconds = stream.path("duration").asDouble(0);
            long actualFrames = stream.path("nb_frames").asLong(0);
            if (!Double.isFinite(actualFps) || actualFps <= 0 || seconds <= 0) throw unavailable();
            if (frames < 1 || !Double.isFinite(fps) || fps <= 0 || Math.abs(actualFps - fps) > 0.001
                    || Math.abs(seconds - frames / fps) > 0.5 / fps
                    || (actualFrames > 0 && actualFrames != frames)) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "timeline_video_mismatch",
                        "历史工程的时长或帧率与视频不一致，不能恢复片段轨道");
            }
        } catch (IOException | NumberFormatException failure) {
            throw unavailable();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw unavailable();
        } finally {
            if (process != null && process.isAlive()) process.destroyForcibly();
            if (output != null) try { Files.deleteIfExists(output); } catch (IOException ignored) { }
        }
    }

    private ApiException unavailable() {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "timeline_probe_failed", "无法核对视频规格，暂不能恢复轨道");
    }
}
