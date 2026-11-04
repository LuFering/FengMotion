package com.fengmotion.server.reference.api;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.reference.domain.ReferenceCollection;
import com.fengmotion.server.reference.service.ReferenceCollectionService;
import com.fengmotion.server.reference.service.ReferenceVideoService;

/**
 * 参考集合接口（契约 library.md §5）。
 *
 * <p>删除集合不删片段；成员里不存在的片段 ID 会 400 拒绝而不是静默丢弃。</p>
 */
@RestController
@RequestMapping("/api/reference-collections")
public class ReferenceCollectionController {

    private final ReferenceCollectionService collections;

    public ReferenceCollectionController(ReferenceCollectionService collections) {
        this.collections = collections;
    }

    /** 集合列表。 */
    @GetMapping
    public List<CollectionResponse> list() {
        return collections.list().stream().map(ReferenceCollectionController::toResponse).toList();
    }

    /** 新建集合。 */
    @PostMapping
    public ResponseEntity<CollectionResponse> create(@RequestBody CollectionRequest request) {
        ReferenceCollection created = collections.create(
                request == null ? null : request.name(),
                request == null ? null : request.note(),
                request == null ? null : request.segmentIds());
        return ResponseEntity.status(HttpStatus.CREATED).body(toResponse(created));
    }

    /** 改名 / 备注 / 成员。 */
    @PatchMapping("/{collectionId}")
    public CollectionResponse update(@PathVariable String collectionId,
            @RequestBody CollectionRequest request) {
        ReferenceCollection updated = collections.update(collectionId,
                request == null ? null : request.name(),
                request == null ? null : request.note(),
                request == null ? null : request.segmentIds());
        return toResponse(updated);
    }

    /** 删除集合；片段本身保留。 */
    @DeleteMapping("/{collectionId}")
    public ResponseEntity<Void> delete(@PathVariable String collectionId) {
        collections.delete(collectionId);
        return ResponseEntity.noContent().build();
    }

    private static CollectionResponse toResponse(ReferenceCollection c) {
        return new CollectionResponse(c.id(), c.name(), c.note(), c.segmentIds(),
                c.segmentIds().size(), c.createdAt().toString(), c.updatedAt().toString());
    }

    /** 集合响应。 */
    public record CollectionResponse(
            String id,
            String name,
            String note,
            List<String> segmentIds,
            int segmentCount,
            String createdAt,
            String updatedAt) {
    }

    /** 新建/更新请求；更新时 null 字段表示不改。 */
    public record CollectionRequest(String name, String note, List<String> segmentIds) {
    }
}
