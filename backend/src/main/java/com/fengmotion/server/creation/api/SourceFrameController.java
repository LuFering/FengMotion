package com.fengmotion.server.creation.api;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.*;
import com.fengmotion.server.creation.service.SourceFrameService;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/source/frame")
@RequiredArgsConstructor
public class SourceFrameController {
    private final SourceFrameService frames;
    @ModelAttribute public void noCache(HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }
    @PostMapping public SourceFrameService.Frame capture(@PathVariable String projectId, @RequestBody SourceFrameService.Request request) {
        return frames.capture(projectId, request);
    }
}
