package com.fengmotion.server.project.api;

import java.util.List;
import org.springframework.web.bind.annotation.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.project.store.LocalStateStore;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/local-documents")
@RequiredArgsConstructor
public class LocalStateController {
    private final LocalStateStore store;
    private final com.fengmotion.server.project.service.ProjectOperationLock operations;
    private final com.fengmotion.server.project.store.ProjectRepository projects;
    private static final java.util.Set<String> PUBLIC_NAMES=java.util.Set.of("workflow","workflow-run","review","editor-document","editor-render","workflow-version");
    public record Write(String projectId, long expectedRevision, JsonNode data, boolean deleted) {}
    @GetMapping public List<LocalStateStore.Document> list() { return store.listNamespaces(PUBLIC_NAMES); }
    @GetMapping("/page")
    public org.springframework.http.ResponseEntity<LocalStateStore.Page> page(
            @RequestParam(required = false) String namespace,
            @RequestParam(required = false) String projectId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") int limit) {
        if (namespace != null && !PUBLIC_NAMES.contains(namespace)) throw new com.fengmotion.server.common.ApiException(
                org.springframework.http.HttpStatus.BAD_REQUEST, "validation_error", "文档类型无效");
        return org.springframework.http.ResponseEntity.ok().cacheControl(org.springframework.http.CacheControl.noStore())
                .body(store.page(namespace == null ? PUBLIC_NAMES : java.util.Set.of(namespace), projectId, cursor, limit));
    }
    @PutMapping("/{namespace}/{id}") public LocalStateStore.Document put(@PathVariable String namespace, @PathVariable String id, @RequestBody Write body) {
        if (!PUBLIC_NAMES.contains(namespace)) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST,"文档类型无效");
        if (body == null) throw new com.fengmotion.server.common.ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "validation_error", "文档请求不能为空");
        synchronized (store) {
            var original = store.find(namespace, id);
            String previousProject = original.map(LocalStateStore.Document::projectId).orElse(null);
            try (var previousActivity = operations.participate(previousProject);
                 var nextActivity = operations.participate(body.projectId())) {
                if (!original.equals(store.find(namespace, id))) throw new com.fengmotion.server.common.ApiException(
                        org.springframework.http.HttpStatus.CONFLICT, "document_conflict", "文档在取得项目准入前已变化，请重新读取");
                if (body.projectId() != null && !body.projectId().isBlank()) projects.findById(body.projectId()).orElseThrow(() ->
                        new com.fengmotion.server.common.ApiException(org.springframework.http.HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
                return store.put(namespace, id, body.projectId(), body.expectedRevision(), body.data(), body.deleted());
            }
        }
    }
}
