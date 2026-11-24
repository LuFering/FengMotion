package com.fengmotion.server.creation.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import com.fengmotion.server.render.service.VideoTimeline;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class VersionExportService {
    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ProjectOperationLock operations;
    private final VersionReviewService reviews;
    private final ObjectMapper json;

    public Receipt export(String projectId, WorkbenchJobs.Request request) {
        operations.acquire(projectId);
        try {
            var existing = existing(projectId, request);
            if (existing.isPresent()) return existing.get();
            var project = projects.findById(projectId).orElseThrow(() -> error(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
            if (scenes.find(projectId).map(current -> current.version()).orElse(0L) != request.version()) throw changed();
            var version = scenes.findVersion(projectId, request.version()).orElseThrow(() -> error(HttpStatus.NOT_FOUND, "not_found", "版本不存在"));
            var review = reviews.read(projectId, request.version());
            if (!"approved".equals(review.state()) || review.latest() == null || !request.reviewId().equals(review.latest().reviewId())
                    || !request.videoHash().equals(review.videoHash())) throw error(HttpStatus.CONFLICT, "export_review_required", "此版本没有匹配当前视频的批准记录，未导出");
            Path video = VideoTimeline.projectVideo(project.rootPath(), version.artifactPath());
            Path root = Path.of(project.rootPath()).toAbsolutePath().normalize();
            Path directory = directory(root, request.requestId());
            Path staged = null;
            try {
                Files.createDirectories(directory.getParent());
                staged = Files.createTempDirectory(directory.getParent(), ".export-staging-");
                String extension = video.getFileName().toString().substring(video.getFileName().toString().lastIndexOf('.')).toLowerCase(java.util.Locale.ROOT);
                String fileName = "video" + extension;
                Path copy = staged.resolve(fileName);
                try (var input = Files.newInputStream(video, LinkOption.NOFOLLOW_LINKS); var output = Files.newOutputStream(copy)) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) { CreationCancellation.requireRunning(); output.write(buffer, 0, count); }
                }
                if (!request.videoHash().equals(VideoTimeline.videoHash(copy)) || !request.videoHash().equals(VideoTimeline.videoHash(video))) throw changed();
                Receipt receipt = new Receipt(projectId, request.requestId(), request.version(), request.reviewId(), request.videoHash(),
                        "exports/" + directory.getFileName() + "/" + fileName, "exports/" + directory.getFileName() + "/receipt.json",
                        Files.size(copy), "reviewed-local-copy", "local-review-api", Instant.now().toString());
                var manifest = json.createObjectNode();
                manifest.set("request", json.valueToTree(request));
                manifest.set("receipt", json.valueToTree(receipt));
                manifest.set("review", json.valueToTree(review.latest()));
                Files.writeString(staged.resolve("receipt.json"), json.writerWithDefaultPrettyPrinter().writeValueAsString(manifest));
                CreationCancellation.requireRunning();
                directory(root, request.requestId());
                Files.move(staged, directory, StandardCopyOption.ATOMIC_MOVE);
                staged = null;
                return receipt;
            } catch (IOException failure) { throw error(HttpStatus.INTERNAL_SERVER_ERROR, "export_failed", "导出复制失败，未登记新成片版本"); }
            finally {
                if (staged != null) try (var files = Files.walk(staged)) {
                    for (Path file : files.sorted(java.util.Comparator.reverseOrder()).toList()) Files.deleteIfExists(file);
                } catch (IOException ignored) { }
            }
        } finally { operations.release(projectId); }
    }

    public Optional<Receipt> existing(String projectId, WorkbenchJobs.Request request) {
        var project = projects.findById(projectId).orElseThrow(() -> error(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        Path root = Path.of(project.rootPath()).toAbsolutePath().normalize();
        Path directory = directory(root, request.requestId());
        if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) return Optional.empty();
        try {
            Path manifest = directory.resolve("receipt.json");
            if (!Files.isRegularFile(manifest, LinkOption.NOFOLLOW_LINKS)) throw invalid();
            var envelope = json.readTree(com.fengmotion.server.common.ProcessOutput.read(manifest, 32768));
            if (envelope == null || !request.equals(json.treeToValue(envelope.path("request"), WorkbenchJobs.Request.class))) throw invalid();
            Receipt receipt = json.treeToValue(envelope.path("receipt"), Receipt.class);
            if (receipt == null || !projectId.equals(receipt.projectId()) || receipt.version() != request.version()
                    || !request.videoHash().equals(receipt.videoHash()) || !request.reviewId().equals(receipt.reviewId())) throw invalid();
            Path video = VideoTimeline.projectVideo(project.rootPath(), receipt.artifactPath());
            if (!video.getParent().equals(directory.toRealPath()) || !receipt.videoHash().equals(VideoTimeline.videoHash(video))
                    || Files.size(video) != receipt.sizeBytes()) throw invalid();
            return Optional.of(receipt);
        } catch (IOException | IllegalArgumentException failure) { throw invalid(); }
    }

    private static Path directory(Path root, String id) {
        if (id == null || !id.matches("[a-zA-Z0-9_-]{1,128}")) throw invalid();
        Path exports = root.resolve("exports");
        Path target = exports.resolve("export-" + id);
        if (Files.isSymbolicLink(root) || Files.isSymbolicLink(exports) || Files.isSymbolicLink(target)) throw invalid();
        return target;
    }
    private static ApiException changed() { return error(HttpStatus.CONFLICT, "export_source_changed", "导出版本或视频内容已变化，请重新核验并审阅"); }
    private static ApiException invalid() { return error(HttpStatus.UNPROCESSABLE_ENTITY, "export_receipt_invalid", "已有导出目录或凭据无效，未覆盖或重复导出"); }
    private static ApiException error(HttpStatus status, String code, String message) { return new ApiException(status, code, message); }
    public record Receipt(String projectId, String requestId, long version, String reviewId, String videoHash, String artifactPath,
                          String receiptPath, long sizeBytes, String scope, String recordedVia, String exportedAt) { }
}
