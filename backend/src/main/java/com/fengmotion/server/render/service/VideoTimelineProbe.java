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
        verify(video, frames, fps, null, null);
    }

    public void verify(Path video, int frames, double fps, Integer width, Integer height) {
        Path output = null;
        Process process = null;
        try {
            output = Files.createTempFile("fm-timeline-probe-", ".json");
            process = new ProcessBuilder(binary, "-v", "error", "-select_streams", "v:0",
                    "-show_entries", "stream=avg_frame_rate,duration,nb_frames,width,height", "-of", "json", video.toString())
                    .redirectOutput(output.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD).start();
            if (!process.waitFor(30, TimeUnit.SECONDS) || process.exitValue() != 0) throw unavailable();
            var document = json.readTree(com.fengmotion.server.common.ProcessOutput.read(output, 65536));
            if (document == null) throw unavailable();
            var stream = document.path("streams").path(0);
            String[] ratio = stream.path("avg_frame_rate").asText("").split("/");
            double actualFps = ratio.length == 2 ? Double.parseDouble(ratio[0]) / Double.parseDouble(ratio[1]) : 0;
            double seconds = stream.path("duration").asDouble(0);
            long actualFrames = stream.path("nb_frames").asLong(0);
            if (!Double.isFinite(actualFps) || actualFps <= 0 || !Double.isFinite(seconds) || seconds <= 0) throw unavailable();
            if ((width != null || height != null) && actualFrames <= 0) throw unavailable();
            if (frames < 1 || !Double.isFinite(fps) || fps <= 0 || Math.abs(actualFps - fps) > 0.001
                    || Math.abs(seconds - frames / fps) > 0.5 / fps
                    || width != null && stream.path("width").asInt() != width
                    || height != null && stream.path("height").asInt() != height
                    || (actualFrames > 0 && actualFrames != frames)) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "timeline_video_mismatch",
                        "版本记录的时长、帧率或画布与实际视频不一致");
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
