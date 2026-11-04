package com.fengmotion.server.reference.api;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.common.Pagination;
import com.fengmotion.server.reference.api.dto.ReferenceSegmentResponse;
import com.fengmotion.server.reference.api.dto.ReferenceSegmentResponse.AnalysisValueResponse;
import com.fengmotion.server.reference.domain.AnalysisValue;
import com.fengmotion.server.reference.domain.ReferenceSegment;
import com.fengmotion.server.reference.domain.ReferenceStates;
import com.fengmotion.server.reference.domain.ReferenceVideo;
import com.fengmotion.server.reference.service.ReferenceVideoService;
import com.fengmotion.server.reference.store.ReferenceRepository.SegmentQuery;
import com.fengmotion.server.reference.store.ReferenceRepository.VideoQuery;

/**
 * 参考片接口（契约 docs/contracts/library.md §4）。
 *
 * <p>本阶段提供：视频导入、播放信息、片段增删改、收藏与最近浏览。
 * <strong>不提供自动分析端点</strong>：切分与观察由用户手工完成，
 * 分析维度停在 pending —— 契约 §4.3 要求解析能力未接入时返回
 * {@code 422 capability_unavailable}，而不是伪造 {@code partial}。</p>
 */
@RestController
@RequestMapping("/api/reference-videos")
public class ReferenceVideoController {

    private final ReferenceVideoService service;

    public ReferenceVideoController(ReferenceVideoService service) {
        this.service = service;
    }

    /** 视频列表。 */
    @GetMapping
    public VideoPageResponse list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") int limit) {
        Pagination.requireValidLimit(limit, "每页数量需在 1 到 " + Pagination.MAX_LIMIT + " 之间");
        int offset = Pagination.decodeOffsetCursor(cursor, "游标无效");
        VideoQuery query = new VideoQuery(
                ReferenceStates.Status.fromWire(status), blankToNull(tag), blankToNull(q), limit, offset);
        List<ReferenceVideo> found = service.searchVideos(query);
        int total = service.countVideos(query);
        List<VideoResponse> items = found.stream().map(v -> toVideo(v, service.segmentsOf(v.id()))).toList();
        String next = offset + found.size() < total
                ? Pagination.encodeCursor(offset + found.size())
                : null;
        return new VideoPageResponse(items, next, total);
    }

    /**
     * 导入一个视频作为参考片。
     *
     * <p>文件先存成素材（同一视频不在素材库与参考片库各存一份），再登记参考片。</p>
     */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ImportResponse> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false) String title) {
        if (file == null || file.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文件内容为空");
        }
        ReferenceVideoService.ImportResult result;
        try (InputStream in = file.getInputStream()) {
            result = service.importVideo(file.getOriginalFilename(), file.getContentType(), title, in);
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "读取上传内容失败");
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new ImportResponse(toVideo(result.video(), service.segmentsOf(result.video().id())),
                        result.deduped()));
    }

    /** 视频详情（含片段数）。 */
    @GetMapping("/{videoId}")
    public VideoResponse get(@PathVariable String videoId) {
        ReferenceVideo video = service.requireVideo(videoId);
        return toVideo(video, service.segmentsOf(videoId));
    }

    /** 更新视频元信息。 */
    @PatchMapping("/{videoId}")
    public VideoResponse update(@PathVariable String videoId, @RequestBody UpdateVideoRequest request) {
        ReferenceVideo updated = service.updateVideo(videoId,
                request == null ? null : request.title(),
                request == null ? null : request.description(),
                request == null ? null : request.tags());
        return toVideo(updated, service.segmentsOf(videoId));
    }

    /** 删除参考片（不删素材文件）。 */
    @DeleteMapping("/{videoId}")
    public ResponseEntity<Void> delete(@PathVariable String videoId) {
        service.deleteVideo(videoId);
        return ResponseEntity.noContent().build();
    }

    /** 该视频的全部片段。 */
    @GetMapping("/{videoId}/segments")
    public List<ReferenceSegmentResponse> listSegments(@PathVariable String videoId) {
        service.requireVideo(videoId);
        return service.segmentsOf(videoId).stream().map(ReferenceVideoController::toSegment).toList();
    }

    /** 新增片段。 */
    @PostMapping("/{videoId}/segments")
    public ResponseEntity<ReferenceSegmentResponse> addSegment(@PathVariable String videoId,
            @RequestBody AddSegmentRequest request) {
        if (request == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "请求体不能为空");
        }
        ReferenceSegment segment = service.addSegment(videoId, request.startMs(), request.endMs(),
                request.tags());
        return ResponseEntity.status(HttpStatus.CREATED).body(toSegment(segment));
    }

    /**
     * 发起自动解析 —— 本阶段不提供。
     *
     * <p>契约 §4.3：解析能力未接入时返回 {@code 422 capability_unavailable}，
     * 视频保持 {@code pending}，<strong>不伪造 partial</strong>。</p>
     */
    @PostMapping("/{videoId}/analyze")
    public ResponseEntity<Void> analyze(@PathVariable String videoId) {
        service.requireVideo(videoId);
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "capability_unavailable",
                "自动切分与视频分析尚未接入；当前可手工标记片段并填写观察");
    }

    // ── 转换 ──

    static ReferenceSegmentResponse toSegment(ReferenceSegment s) {
        return new ReferenceSegmentResponse(
                s.id(),
                s.videoId(),
                s.index(),
                s.startMs(),
                s.endMs(),
                s.durationMs(),
                s.status().wire(),
                s.tags(),
                s.observation(),
                s.inference(),
                s.suggestion(),
                toAnalysisMap(s.analysis()),
                toAnalysisLoose(s.extraAnalysis()),
                s.createdAt().toString(),
                s.updatedAt().toString());
    }

    /** 六维分析：键用 wire 字符串（cameraMove 等），与契约一致。 */
    private static java.util.Map<String, AnalysisValueResponse> toAnalysisMap(
            java.util.Map<ReferenceStates.AnalysisKey, AnalysisValue> analysis) {
        java.util.Map<String, AnalysisValueResponse> out = new java.util.LinkedHashMap<>();
        if (analysis == null) {
            return out;
        }
        for (var entry : analysis.entrySet()) {
            out.put(entry.getKey().wire(), toAnalysis(entry.getValue()));
        }
        return out;
    }

    /** 额外维度：键本身就是字符串（后端可扩展）。 */
    private static java.util.Map<String, AnalysisValueResponse> toAnalysisLoose(
            java.util.Map<String, AnalysisValue> analysis) {
        java.util.Map<String, AnalysisValueResponse> out = new java.util.LinkedHashMap<>();
        if (analysis == null) {
            return out;
        }
        for (var entry : analysis.entrySet()) {
            out.put(entry.getKey(), toAnalysis(entry.getValue()));
        }
        return out;
    }

    private static AnalysisValueResponse toAnalysis(AnalysisValue v) {
        return new AnalysisValueResponse(v.value(),
                v.source() == null ? null : v.source().wire(),
                v.confidence(), v.evidence(), v.pending());
    }

    private static VideoResponse toVideo(ReferenceVideo v, List<ReferenceSegment> segments) {
        return new VideoResponse(
                v.id(),
                v.title(),
                v.durationMs(),
                v.source(),
                v.description(),
                v.tags(),
                v.assetId(),
                // 有素材才有可播放的地址；没有时如实为 null，界面显示「仅静帧」。
                v.playable() ? "/api/assets/" + v.assetId() + "/content" : null,
                v.thumbnailUrl(),
                v.status().wire(),
                segments.size(),
                v.createdAt().toString(),
                v.updatedAt().toString(),
                v.demo());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /**
     * 视频响应。
     *
     * @param fileUrl 可播放地址；为 null 表示本机没有文件（演示或纯外部链接）
     */
    public record VideoResponse(
            String id,
            String title,
            long durationMs,
            String source,
            String description,
            List<String> tags,
            String assetId,
            String fileUrl,
            String thumbnailUrl,
            String status,
            int segmentCount,
            String createdAt,
            String updatedAt,
            boolean demo) {
    }

    /** 分页结果。 */
    public record VideoPageResponse(List<VideoResponse> items, String nextCursor, int total) {
    }

    /** 导入结果；{@code deduped} 表示命中了已有参考片。 */
    public record ImportResponse(VideoResponse video, boolean deduped) {
    }

    /** 更新视频请求。 */
    public record UpdateVideoRequest(String title, String description, List<String> tags) {
    }

    /** 新增片段请求；时间单位毫秒。 */
    public record AddSegmentRequest(long startMs, long endMs, List<String> tags) {
    }
}
