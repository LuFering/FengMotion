package com.fengmotion.server.creation.api;

import java.util.List;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import com.fengmotion.server.creation.service.WorkbenchJobs;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/workbench-jobs")
@RequiredArgsConstructor
public class WorkbenchJobController {
    private final WorkbenchJobs jobs;
    @ModelAttribute public void noCache(HttpServletResponse response) { response.setHeader("Cache-Control","no-store"); }
    @PostMapping @ResponseStatus(HttpStatus.ACCEPTED)
    public WorkbenchJobs.Job submit(@PathVariable String projectId,@RequestBody WorkbenchJobs.Request request) { return jobs.submit(projectId,request); }
    @GetMapping public List<WorkbenchJobs.Job> list(@PathVariable String projectId) { return jobs.list(projectId); }
    @GetMapping("/{requestId}") public WorkbenchJobs.Job get(@PathVariable String projectId,@PathVariable String requestId) { return jobs.get(projectId,requestId); }
    @PostMapping("/{requestId}/cancel") public WorkbenchJobs.Job cancel(@PathVariable String projectId,@PathVariable String requestId) { return jobs.cancel(projectId,requestId); }
}
