package com.fengmotion.server.creation.api;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import com.fengmotion.server.creation.service.SourceRenderJobs;
import com.fengmotion.server.project.domain.SourceRenderRequest;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/render-jobs")
@RequiredArgsConstructor
public class SourceRenderJobController {
    private final SourceRenderJobs jobs;
    @ModelAttribute public void noCache(HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }
    @PostMapping @ResponseStatus(HttpStatus.ACCEPTED)
    public SourceRenderJobs.Job submit(@PathVariable String projectId, @RequestBody SourceRenderRequest request) {
        return jobs.submit(projectId, request);
    }
    @GetMapping("/{requestId}")
    public SourceRenderJobs.Job get(@PathVariable String projectId, @PathVariable String requestId) { return jobs.get(projectId, requestId); }
    @GetMapping public java.util.List<SourceRenderJobs.Job> list(@PathVariable String projectId) { return jobs.list(projectId); }
    @PostMapping("/{requestId}/cancel")
    public SourceRenderJobs.Job cancel(@PathVariable String projectId, @PathVariable String requestId) { return jobs.cancel(projectId, requestId); }
}
