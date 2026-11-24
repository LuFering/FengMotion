package com.fengmotion.server.creation.api;

import java.io.IOException;

import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.creation.service.ShotCandidateService;
import com.fengmotion.server.project.domain.ShotCandidateRequest;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/scene/versions/{version}/shot-candidates")
@RequiredArgsConstructor
public class ShotCandidateController {
    private final ShotCandidateService candidates;
    @org.springframework.web.bind.annotation.ModelAttribute public void noCache(jakarta.servlet.http.HttpServletResponse response) { response.setHeader("Cache-Control","no-store"); }

    @PostMapping
    public PreviewResponse preview(@PathVariable String projectId, @PathVariable long version,
                                   @RequestBody ShotCandidateRequest request) {
        if (request == null || request.baseVersion() == null || request.baseVersion() != version) {
            throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "validation_error",
                    "路径版本与请求体 baseVersion 不一致");
        }
        var result = candidates.preview(projectId, request);
        String previewUrl = "/api/projects/%s/scene/versions/%d/shot-candidates/%s/preview"
                .formatted(projectId, version, result.candidateId());
        return new PreviewResponse(result.projectId(), result.candidateId(), result.baseVersion(),
                result.sourceHash(), result.shotId(), result.sourceId(), previewUrl,
                result.durationInFrames(), result.width(), result.height(), result.fps(), result.hasVoiceover());
    }

    @org.springframework.web.bind.annotation.GetMapping("/{candidateId}/preview")
    public ResponseEntity<Resource> previewVideo(@PathVariable String projectId, @PathVariable long version,
                                                 @PathVariable String candidateId) throws IOException {
        var preview = candidates.previewFile(projectId, version, candidateId);
        Resource body = new FileSystemResource(preview.path());
        return ResponseEntity.ok().contentType(MediaType.valueOf("video/mp4"))
                .contentLength(preview.size()).cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"shot-preview.mp4\"")
                .body(body);
    }

    @PostMapping("/{candidateId}/commit")
    public CommitResponse commit(@PathVariable String projectId, @PathVariable long version,
                                 @PathVariable String candidateId) {
        var result = candidates.commit(projectId, version, candidateId);
        return new CommitResponse(result.projectId(), result.candidateId(), result.version(),
                result.artifactPath(), result.sourceHash(), result.shotId(), result.sourceId(),
                result.durationInFrames(), result.width(), result.height(), result.fps());
    }

    @DeleteMapping("/{candidateId}")
    public ResponseEntity<Void> discard(@PathVariable String projectId, @PathVariable long version,
                                        @PathVariable String candidateId) {
        candidates.discard(projectId, version, candidateId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    public record PreviewResponse(String projectId, String candidateId, long baseVersion,
                                 String sourceHash, String shotId, String sourceId, String previewUrl,
                                 int durationInFrames, int width, int height, double fps, boolean hasVoiceover) { }

    public record CommitResponse(String projectId, String candidateId, long version, String artifactPath,
                                 String sourceHash, String shotId, String sourceId, int durationInFrames,
                                 int width, int height, double fps) { }
}
