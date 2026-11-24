package com.fengmotion.server.project.api;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.*;
import com.fengmotion.server.project.service.SourceRecoveryService;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/source/recovery")
@RequiredArgsConstructor
public class SourceRecoveryController {
    private final SourceRecoveryService recovery;
    @ModelAttribute public void noCache(HttpServletResponse response) { response.setHeader("Cache-Control","no-store"); }
    @GetMapping public SourceRecoveryService.Status inspect(@PathVariable String projectId) { return recovery.inspect(projectId); }
    @PostMapping public SourceRecoveryService.Status recover(@PathVariable String projectId, @RequestBody SourceRecoveryService.Request request) { return recovery.recover(projectId,request); }
}
