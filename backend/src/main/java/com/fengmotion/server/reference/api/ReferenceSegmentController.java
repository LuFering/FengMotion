package com.fengmotion.server.reference.api;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.common.Pagination;
import com.fengmotion.server.reference.api.dto.ReferenceSegmentResponse;
import com.fengmotion.server.reference.domain.ReferenceSegment;
import com.fengmotion.server.reference.domain.ReferenceStates;
import com.fengmotion.server.reference.service.ReferenceVideoService;
import com.fengmotion.server.reference.store.ReferenceRepository.SegmentQuery;

/**
 * 参考片段接口（契约 library.md §4.2–§4.3）。
 *
 * <p>片段可以被手工编辑（时间范围、标签、观察、建议），但 {@code inference}
 * 只能由分析流程写入 —— 允许手工改推断，等于把人的猜测伪装成模型结论。</p>
 */
@RestController
@RequestMapping("/api/reference-segments")
public class ReferenceSegmentController {

    private final ReferenceVideoService service;

    public ReferenceSegmentController(ReferenceVideoService service) {
        this.service = service;
    }

    /** 片段列表，可按视频、状态、标签与文本筛选。 */
    @GetMapping
    public SegmentPageResponse list(
            @RequestParam(required = false) String videoId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "100") int limit) {
        Pagination.requireValidLimit(limit, "每页数量需在 1 到 " + Pagination.MAX_LIMIT + " 之间");
        int offset = Pagination.decodeOffsetCursor(cursor, "游标无效");
        SegmentQuery query = new SegmentQuery(videoId, ReferenceStates.Status.fromWire(status),
                blankToNull(tag), blankToNull(q), limit, offset);
        List<ReferenceSegment> found = service.searchSegments(query);
        int total = service.countSegments(query);
        List<ReferenceSegmentResponse> items = found.stream()
                .map(ReferenceVideoController::toSegment)
                .toList();
        String next = offset + found.size() < total
                ? Pagination.encodeCursor(offset + found.size())
                : null;
        return new SegmentPageResponse(items, next, total);
    }

    /**
     * 片段详情。
     *
     * <p>读取即记一次「最近浏览」—— 与契约 §5「recent 由后端在打开详情时自动更新」一致。</p>
     */
    @GetMapping("/{segmentId}")
    public ReferenceSegmentResponse get(@PathVariable String segmentId) {
        ReferenceSegment segment = service.requireSegment(segmentId);
        service.touchRecent(segmentId);
        return ReferenceVideoController.toSegment(segment);
    }

    /** 更新片段：时间范围、标签、观察、建议。 */
    @PatchMapping("/{segmentId}")
    public ReferenceSegmentResponse update(@PathVariable String segmentId,
            @RequestBody UpdateSegmentRequest request) {
        ReferenceSegment updated = service.updateSegment(segmentId,
                request == null ? null : request.startMs(),
                request == null ? null : request.endMs(),
                request == null ? null : request.tags(),
                request == null ? null : request.observation(),
                request == null ? null : request.suggestion());
        return ReferenceVideoController.toSegment(updated);
    }

    /** 删除片段。 */
    @DeleteMapping("/{segmentId}")
    public ResponseEntity<Void> delete(@PathVariable String segmentId) {
        service.deleteSegment(segmentId);
        return ResponseEntity.noContent().build();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /** 分页结果。 */
    public record SegmentPageResponse(List<ReferenceSegmentResponse> items, String nextCursor, int total) {
    }

    /**
     * 更新片段请求；全部字段可空 = 不改。
     *
     * <p>刻意没有 {@code inference} 字段：推断只能由分析流程写。</p>
     */
    public record UpdateSegmentRequest(
            Long startMs,
            Long endMs,
            List<String> tags,
            String observation,
            String suggestion) {
    }
}
