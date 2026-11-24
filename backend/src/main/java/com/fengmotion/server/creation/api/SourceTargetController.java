package com.fengmotion.server.creation.api;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.*;
import com.fengmotion.server.creation.service.SourceTargetService;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/source/target")
@RequiredArgsConstructor
public class SourceTargetController {
    private final SourceTargetService targets;
    @ModelAttribute public void noCache(HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }
    @PostMapping public SourceTargetService.Resolved resolve(@PathVariable String projectId,
            @RequestBody SourceTargetService.Selection request) { return targets.resolve(projectId, request); }
}
