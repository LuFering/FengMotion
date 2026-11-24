package com.fengmotion.server.creation.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.concurrent.Semaphore;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.SourceRenderRequest;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.service.ProjectWorktreeService;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.render.service.ProjectFilmRenderer;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class SourceFrameService {
    private final ProjectRepository projects;
    private final ProjectWorktreeService worktrees;
    private final ProjectSourceSnapshots snapshots;
    private final ProjectFilmConfig configs;
    private final ProjectFilmRenderer renderer;
    private final ProjectOperationLock operations;
    private final Semaphore capacity = new Semaphore(2);

    public Frame capture(String projectId, Request request) {
        if (request == null || request.frame() == null || request.frame() < 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "需要版本、源码指纹和非负帧号");
        }
        new SourceRenderRequest("frame", request.baseVersion(), request.sourceHash(), null).validate();
        try (var activity = operations.participate(projectId)) {
            var state = worktrees.read(projectId);
            if (state.version() != request.baseVersion()) throw conflict("scene_version_conflict", "版本已变化，请重新选帧");
            if (!request.sourceHash().equals(state.sourceHash())) throw conflict("source_changed", "源码已变化，请重新选帧");
            Path root = ProjectWorktreeService.root(projects.findById(projectId).orElseThrow());
            com.fengmotion.server.project.service.SourceWriteGuard.requireRecovered(root);
            if (!capacity.tryAcquire()) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "frame_queue_full", "取帧忙，请稍后重试");
            String snapshot = null;
            Path image = null;
            try {
                snapshot = snapshots.captureVerified(root, request.sourceHash());
                Path frozen = snapshots.resolve(root, snapshot, request.sourceHash());
                image = Files.createTempFile("fm-source-frame-", ".png");
                Files.delete(image);
                var result = renderer.renderStill(frozen, configs.read(frozen), image, request.frame());
                if (!Files.isRegularFile(image, java.nio.file.LinkOption.NOFOLLOW_LINKS)) throw invalidImage();
                long size = Files.size(image);
                if (size > 3_700_000 || size < 8) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "frame_invalid", "取帧图片超过 Agent 图片大小限制或内容无效");
                byte[] bytes;
                try (var input = Files.newInputStream(image, java.nio.file.LinkOption.NOFOLLOW_LINKS)) { bytes = input.readNBytes(3_700_001); }
                if (bytes.length > 3_700_000) throw invalidImage();
                if (!java.util.Arrays.equals(java.util.Arrays.copyOf(bytes, 8), new byte[]{(byte)137,80,78,71,13,10,26,10})) {
                    throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "frame_invalid", "渲染器没有输出 PNG 图片");
                }
                if (request.frame() >= result.durationInFrames() || result.width() < 1 || result.height() < 1
                        || (long) result.width() * result.height() > 33_177_600) throw invalidImage();
                try (var input = new javax.imageio.stream.MemoryCacheImageInputStream(new java.io.ByteArrayInputStream(bytes))) {
                    var readers = javax.imageio.ImageIO.getImageReaders(input);
                    if (!readers.hasNext()) throw invalidImage();
                    var reader = readers.next();
                    try {
                        reader.setInput(input);
                        if (!"png".equalsIgnoreCase(reader.getFormatName()) || reader.getWidth(0) != result.width()
                                || reader.getHeight(0) != result.height() || reader.read(0) == null) throw invalidImage();
                    } finally { reader.dispose(); }
                } catch (IOException malformed) { throw invalidImage(); }
                return new Frame(projectId, request.baseVersion(), request.sourceHash(), request.frame(),
                        result.width(), result.height(), result.fps(), "data:image/png;base64," + Base64.getEncoder().encodeToString(bytes));
            } catch (IOException failure) {
                throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "frame_failed", "无法读取工作稿渲染帧");
            } finally {
                if (snapshot != null) snapshots.discard(root, snapshot);
                try { if (image != null) Files.deleteIfExists(image); }
                catch (IOException ignored) { }
                capacity.release();
            }
        }
    }

    private static ApiException conflict(String code, String message) { return new ApiException(HttpStatus.CONFLICT, code, message); }
    private static ApiException invalidImage() { return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "frame_invalid", "取帧图片不可解码、规格不一致或超出安全限制"); }
    public record Request(Long baseVersion, String sourceHash, Integer frame) { }
    public record Frame(String projectId, long baseVersion, String sourceHash, int frame,
                        int width, int height, double fps, String dataUrl) { }
}
