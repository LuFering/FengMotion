package com.fengmotion.server.workflow.api;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.workflow.service.WorkflowDraftService;

import lombok.RequiredArgsConstructor;

/**
 * 工作稿文件端点：视觉构想（lookdev-brief）与导演处理（film-plan）。
 *
 * <p>只开放这两份文件，写入必须带读取时的 sha256，见 {@link WorkflowDraftService}。</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/workflow/drafts")
@RequiredArgsConstructor
public class WorkflowDraftController {

    private final WorkflowDraftService drafts;

    @GetMapping
    public List<WorkflowDraftService.Draft> list(@PathVariable String projectId) {
        return drafts.list(projectId);
    }

    @GetMapping("/{name}")
    public WorkflowDraftService.Draft get(@PathVariable String projectId, @PathVariable String name) {
        return drafts.get(projectId, name);
    }

    @PutMapping("/{name}")
    public WorkflowDraftService.Draft put(@PathVariable String projectId, @PathVariable String name,
                                          @RequestBody(required = false) WriteRequest request) {
        if (request == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "缺少请求体");
        }
        return drafts.put(projectId, name, request.content(), request.baseSha256());
    }

    /**
     * 写入请求。
     *
     * @param content    完整正文
     * @param baseSha256 读取时拿到的 sha256；文件当时不存在则省略
     */
    public record WriteRequest(String content, String baseSha256) {
    }
}
