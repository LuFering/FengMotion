package com.fengmotion.server.preset.api;

import java.util.List;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.preset.domain.MappingJob;
import com.fengmotion.server.preset.service.MappingJobs;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class MappingJobController {
    private final MappingJobs jobs;
    @ModelAttribute public void noCache(HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }

    @PostMapping("/skill-packages/{packageId}/mapping-jobs")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public MappingJob submit(@PathVariable String packageId, @RequestBody(required = false) Request request) {
        if (request == null) throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "缺少 skillPath");
        return jobs.submit(packageId, request.skillPath());
    }

    @GetMapping("/skill-packages/{packageId}/mapping-jobs")
    public List<MappingJob> list(@PathVariable String packageId, @RequestParam(defaultValue = "false") boolean active) {
        return jobs.list(packageId, active);
    }

    @GetMapping("/mapping-jobs/{jobId}")
    public MappingJob get(@PathVariable String jobId) { return jobs.get(jobId); }

    @PostMapping("/mapping-jobs/{jobId}/cancel")
    public MappingJob cancel(@PathVariable String jobId) { return jobs.cancel(jobId); }

    public record Request(String skillPath) { }
}
