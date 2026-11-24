package com.fengmotion.server.creation.api;

import org.springframework.web.bind.annotation.*;
import com.fengmotion.server.creation.service.VersionReviewService;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/scene/versions/{version}/reviews")
@RequiredArgsConstructor
public class VersionReviewController {
    private final VersionReviewService reviews;
    @ModelAttribute public void noCache(jakarta.servlet.http.HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }
    @GetMapping public VersionReviewService.Status get(@PathVariable String projectId, @PathVariable long version) { return reviews.read(projectId, version); }
    @PostMapping public VersionReviewService.Decision record(@PathVariable String projectId, @PathVariable long version,
            @RequestBody VersionReviewService.Request request) { return reviews.record(projectId, version, request); }
}
