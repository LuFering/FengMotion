package com.fengmotion.server.creation.api;

import java.util.List;
import org.springframework.web.bind.annotation.*;
import com.fengmotion.server.creation.service.ProjectContentService;
import com.fengmotion.server.creation.service.ProjectContentCountsService;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}")
@RequiredArgsConstructor
public class ProjectContentController {
    private final ProjectContentService content;
    private final ProjectContentCountsService counts;

    @ModelAttribute
    public void noCache(jakarta.servlet.http.HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }

    @GetMapping(value = "/timeline", params = "!path")
    public ProjectContentService.Timeline timeline(@PathVariable String projectId) { return content.read(projectId).timeline(); }

    @GetMapping("/scenes")
    public List<ProjectContentService.Scene> scenes(@PathVariable String projectId) { return content.read(projectId).scenes(); }

    @GetMapping("/scenes/{sceneId}")
    public ProjectContentService.Scene scene(@PathVariable String projectId, @PathVariable String sceneId) {
        return content.scene(projectId, sceneId);
    }

    /**
     * 当前版本的内容统计。detail 接口聚合，不提供批量形式——
     * 批量列表不应为统计引入 N+1 文件 IO。
     */
    @GetMapping("/content-counts")
    public ProjectContentCountsService.Counts counts(@PathVariable String projectId) { return counts.read(projectId); }
}
