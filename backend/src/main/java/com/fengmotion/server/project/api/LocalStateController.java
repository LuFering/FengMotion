package com.fengmotion.server.project.api;

import java.util.List;
import org.springframework.web.bind.annotation.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.project.service.LocalStateStore;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/local-documents")
@RequiredArgsConstructor
public class LocalStateController {
    private final LocalStateStore store;
    public record Write(String projectId, long expectedRevision, JsonNode data, boolean deleted) {}
    @GetMapping public List<LocalStateStore.Document> list() { return store.list().stream().filter(d -> !d.namespace().equals("creation-request") && !d.namespace().equals("resource-evidence")).toList(); }
    @PutMapping("/{namespace}/{id}") public LocalStateStore.Document put(@PathVariable String namespace, @PathVariable String id, @RequestBody Write body) {
        if (!java.util.Set.of("workflow","workflow-run","review","editor-document","editor-render","workflow-version").contains(namespace)) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST,"文档类型无效");
        return store.put(namespace,id,body.projectId(),body.expectedRevision(),body.data(),body.deleted());
    }
}
