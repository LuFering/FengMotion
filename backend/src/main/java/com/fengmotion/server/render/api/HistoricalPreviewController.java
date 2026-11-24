package com.fengmotion.server.render.api;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import com.fengmotion.server.render.service.LivePreviewService;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/scene/versions/{version}/live-preview")
@RequiredArgsConstructor
public class HistoricalPreviewController {
    private final LivePreviewService previews;
    @ModelAttribute public void noCache(HttpServletResponse response) { response.setHeader("Cache-Control","no-store"); }
    @PostMapping public LivePreviewService.Status start(@PathVariable String projectId,@PathVariable long version) { return previews.start(projectId,version); }
    @GetMapping public LivePreviewService.Status get(@PathVariable String projectId,@PathVariable long version) { return previews.get(projectId,version); }
    @DeleteMapping @ResponseStatus(HttpStatus.NO_CONTENT) public void stop(@PathVariable String projectId,@PathVariable long version) { previews.stop(projectId,version); }
}
