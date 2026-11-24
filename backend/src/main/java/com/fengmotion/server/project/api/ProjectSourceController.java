package com.fengmotion.server.project.api;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.fengmotion.server.project.service.ProjectWorktreeService;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/source")
@RequiredArgsConstructor
public class ProjectSourceController {
    private final ProjectWorktreeService worktrees;

    @ModelAttribute
    public void noCache(HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }

    @GetMapping("/state")
    public ProjectWorktreeService.State state(@PathVariable String projectId) { return worktrees.read(projectId); }
}
