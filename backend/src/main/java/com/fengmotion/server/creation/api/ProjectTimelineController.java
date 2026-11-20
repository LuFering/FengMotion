package com.fengmotion.server.creation.api;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.creation.service.ProjectTimelineService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/timeline")
@RequiredArgsConstructor
public class ProjectTimelineController {
    private final ProjectTimelineService timelines;

    @GetMapping
    public ResponseEntity<JsonNode> read(@PathVariable String projectId, @RequestParam String path) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(timelines.read(projectId, path));
    }

    @PostMapping("/recover")
    public JsonNode recover(@PathVariable String projectId, @RequestBody RecoveryRequest request) {
        return timelines.recover(projectId, request.artifactPath());
    }

    public record RecoveryRequest(String artifactPath) { }
}
