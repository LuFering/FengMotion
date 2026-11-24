package com.fengmotion.server.workflow.api;

import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.fengmotion.server.workflow.service.StoryboardService;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/storyboard")
@RequiredArgsConstructor
public class StoryboardController {
    private final StoryboardService storyboards;

    @GetMapping
    public ResponseEntity<List<StoryboardService.Entry>> get(@PathVariable String projectId) {
        var result = storyboards.read(projectId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).eTag(result.sourceHash())
                .header("X-Storyboard-Source", result.source()).body(result.items());
    }
}
