package com.fengmotion.server.creation.api;
import java.util.List;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import com.fengmotion.server.creation.service.CreationJobs;
import com.fengmotion.server.creation.domain.CreateRequest;
import lombok.RequiredArgsConstructor;
@RestController
@RequestMapping("/api/projects/{projectId}/creation-jobs")
@RequiredArgsConstructor
public class CreationJobController {
    private final CreationJobs jobs;
    @ModelAttribute public void noCache(jakarta.servlet.http.HttpServletResponse response){response.setHeader("Cache-Control","no-store");}
    @PostMapping @ResponseStatus(HttpStatus.ACCEPTED) public CreationJobs.Job submit(@PathVariable String projectId,@RequestBody CreateRequest body){return jobs.submit(projectId,body);}
    @GetMapping("/{id}") public CreationJobs.Job get(@PathVariable String projectId,@PathVariable String id){return jobs.get(projectId,id);}
    @GetMapping("/{id}/resources") public com.fasterxml.jackson.databind.JsonNode resources(@PathVariable String projectId,@PathVariable String id){return jobs.evidence(projectId,id);}
    @GetMapping public List<CreationJobs.Job> list(@PathVariable String projectId){return jobs.list(projectId);}
    @PostMapping("/{id}/cancel") public CreationJobs.Job cancel(@PathVariable String projectId,@PathVariable String id){return jobs.cancel(projectId,id);}
}
