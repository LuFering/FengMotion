package com.fengmotion.server.render.api;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.fengmotion.server.render.service.LivePreviewService;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/live-preview")
@RequiredArgsConstructor
public class LivePreviewController {
    private final LivePreviewService previews;

    @ModelAttribute
    public void preventCaching(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
    }

    @PostMapping
    public ResponseEntity<LivePreviewService.Status> start(@PathVariable String projectId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(previews.start(projectId));
    }

    @GetMapping
    public ResponseEntity<LivePreviewService.Status> get(@PathVariable String projectId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(previews.get(projectId));
    }

    @DeleteMapping
    public ResponseEntity<Void> stop(@PathVariable String projectId) {
        previews.stop(projectId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
