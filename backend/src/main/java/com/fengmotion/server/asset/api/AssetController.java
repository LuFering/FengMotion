package com.fengmotion.server.asset.api;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
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
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.fengmotion.server.asset.api.dto.AssetResponse;
import com.fengmotion.server.asset.api.dto.UpdateAssetRequest;
import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.asset.domain.AssetStates;
import com.fengmotion.server.asset.service.AssetService;
import com.fengmotion.server.asset.service.AssetStorage;
import com.fengmotion.server.asset.store.AssetCounts;
import com.fengmotion.server.asset.store.AssetQuery;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.common.Pagination;

/**
 * 素材库接口（契约 docs/contracts/asset.md §3）。
 *
 * <p>文件本体走 {@code /content} 与 {@code /thumbnail} 两个端点，而不是把 URL 写死进 JSON：
 * 后端监听端口由桌面壳在启动时决定（8080 被占用会换端口），任何写进数据的绝对地址
 * 在换端口后都会失效。</p>
 *
 * <p>本阶段刻意<strong>不提供</strong> {@code POST /assets/import}（按绝对路径导入），
 * 路径导入恒返回 422 {@code capability_unavailable} 并在错误里说明原因。
 * 文件选择器与拖拽导入走 {@code POST /assets} 上传，不受影响。</p>
 */
@RestController
@RequestMapping("/api/assets")
public class AssetController {

    private final AssetService assets;
    private final AssetStorage storage;
    private final AssetResponses responses;

    public AssetController(AssetService assets, AssetStorage storage, AssetResponses responses) {
        this.assets = assets;
        this.storage = storage;
        this.responses = responses;
    }

    /**
     * 素材列表。
     *
     * @param mediaType        媒体类型筛选
     * @param sourceType       来源筛选
     * @param reviewStatus     审核筛选
     * @param availability     可用性筛选
     * @param licenseStatus    授权筛选
     * @param processingStatus 处理状态筛选
     * @param folderId         文件夹；传 {@code root} 表示只看根目录
     * @param q               名称/标签子串
     * @param tag              单个标签
     * @param sort             recent / name / size / created
     * @param include          {@code refs} 时才逐条查引用（默认不查，避免 N+1）
     * @param cursor           游标
     * @param limit            每页数量
     * @return 分页结果
     */
    @GetMapping
    public PageResponse list(
            @RequestParam(required = false) String mediaType,
            @RequestParam(required = false) String sourceType,
            @RequestParam(required = false) String reviewStatus,
            @RequestParam(required = false) String availability,
            @RequestParam(required = false) String licenseStatus,
            @RequestParam(required = false) String processingStatus,
            @RequestParam(required = false) String folderId,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false, defaultValue = "recent") String sort,
            @RequestParam(required = false, name = "include") String include,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") int limit) {
        Pagination.requireValidLimit(limit, "每页数量需在 1 到 " + Pagination.MAX_LIMIT + " 之间");
        int offset = Pagination.decodeOffsetCursor(cursor, "游标无效");
        boolean rootOnly = "root".equals(folderId);
        AssetQuery query = new AssetQuery(
                AssetStates.MediaType.fromWire(mediaType),
                AssetStates.SourceType.fromWire(sourceType),
                AssetStates.ReviewStatus.fromWire(reviewStatus),
                AssetStates.Availability.fromWire(availability),
                AssetStates.LicenseStatus.fromWire(licenseStatus),
                AssetStates.ProcessingStatus.fromWire(processingStatus),
                rootOnly ? null : folderId,
                rootOnly,
                blankToNull(q),
                blankToNull(tag),
                sort,
                limit,
                offset);
        boolean withRefs = "refs".equals(include);
        List<Asset> found = assets.search(query);
        int total = assets.count(query);
        List<AssetResponse> items = found.stream()
                .map(asset -> responses.of(asset, withRefs))
                .toList();
        String next = offset + found.size() < total
                ? Pagination.encodeCursor(offset + found.size())
                : null;
        return new PageResponse(items, next, total);
    }

    /** 筛选面与全量计数（不受当前筛选影响）。 */
    @GetMapping("/facets")
    public FacetsResponse facets() {
        AssetCounts counts = assets.counts();
        return new FacetsResponse(counts.total(), counts.mediaTypes(), counts.sourceTypes(),
                counts.reviewStatus(), counts.availability(), counts.licenseStatus());
    }

    /**
     * 上传一个文件入库（复制入库）。
     *
     * <p>这是「文件选择器 / 拖拽」的落点：前端把 File 作为 multipart 提交，
     * 服务端实测大小与哈希后落盘。命中去重时返回已有素材，{@code deduped=true}。</p>
     *
     * <p>文件用 {@code @RequestParam} 而非 {@code @RequestPart}：与同一方法里的
     * {@code folderId}/{@code name} 走同一套参数绑定，否则 multipart 里普通字段
     * 可能拿不到值（表现为「上传成功但 folderId 丢了」这种难查的错）。</p>
     */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<UploadResponse> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false) String folderId,
            @RequestParam(required = false) String name,
            /*
             * 迁移用：内容命中也保留独立记录。
             *
             * 文件本体仍只存一份，但这条记录的名称/标签/授权/文件夹独立 ——
             * 旧库里同内容不同元数据的两条记录都需要被保留下来。
             * 普通导入不传，保持「同一文件不重复出现」的默认行为。
             */
            @RequestParam(required = false, defaultValue = "false") boolean keepSeparateRecord) {
        if (file == null || file.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文件内容为空");
        }
        AssetService.ImportResult result;
        try (InputStream in = file.getInputStream()) {
            result = assets.importFile(file.getOriginalFilename(), file.getContentType(), folderId, name,
                    in, keepSeparateRecord);
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "读取上传内容失败");
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new UploadResponse(responses.of(result.asset(), true), result.deduped()));
    }

    /**
     * 按绝对路径导入 —— 本阶段不提供。
     *
     * <p>契约 asset.md §3.3 的路径导入语义是「通过路径选择后复制入库」。本阶段文件选择与
     * 拖拽已可用（{@link #upload}），路径字符串直传尚未实现，因此如实返回不可用，
     * 而不是假装成功或退化成空结果。</p>
     */
    @PostMapping("/import")
    public ResponseEntity<Void> importByPath() {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "capability_unavailable",
                "按路径导入尚未接入，请用文件选择或拖拽导入");
    }

    /** 素材详情。 */
    @GetMapping("/{assetId}")
    public AssetResponse get(@PathVariable String assetId) {
        return responses.of(assets.require(assetId), true);
    }

    /** 更新素材；带 {@code If-Match} 做乐观锁。 */
    @PatchMapping("/{assetId}")
    public AssetResponse update(@PathVariable String assetId,
            @RequestBody UpdateAssetRequest request,
            @RequestHeader(required = false) String ifMatch) {
        return responses.of(assets.update(assetId, request, ifMatch), true);
    }

    /** 删除素材；被引用时 409 并列出引用方。 */
    @DeleteMapping("/{assetId}")
    public ResponseEntity<Void> delete(@PathVariable String assetId) {
        assets.delete(assetId);
        return ResponseEntity.noContent().build();
    }

    /** 批量删除：返回 207 与逐项结果。 */
    @PostMapping("/batch-delete")
    public ResponseEntity<BatchDeleteResponse> batchDelete(@RequestBody BatchDeleteRequest request) {
        if (request == null || request.ids() == null || request.ids().isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "ids 不能为空");
        }
        List<AssetService.DeleteItemResult> results = assets.deleteMany(request.ids());
        boolean anyFailed = results.stream().anyMatch(item -> !item.ok());
        return ResponseEntity.status(anyFailed ? HttpStatus.MULTI_STATUS : HttpStatus.OK)
                .body(new BatchDeleteResponse(results));
    }

    /**
     * 文件本体。
     *
     * <p>用 {@link org.springframework.core.io.FileSystemResource} 返回，Spring 会处理
     * {@code Range} 请求 —— 音视频拖动进度条依赖这个。</p>
     */
    @GetMapping("/{assetId}/content")
    public ResponseEntity<org.springframework.core.io.Resource> content(@PathVariable String assetId) {
        Asset asset = assets.require(assetId);
        Path file = resolveExisting(asset.fileUrl(), "素材文件已丢失");
        return ResponseEntity.ok()
                .contentType(parseMediaType(asset.mimeType()))
                .body(new org.springframework.core.io.FileSystemResource(file));
    }

    /** 缩略图；没有缩略图时 404，前端回退到类型图标。 */
    @GetMapping("/{assetId}/thumbnail")
    public ResponseEntity<org.springframework.core.io.Resource> thumbnail(@PathVariable String assetId) {
        Asset asset = assets.require(assetId);
        if (asset.thumbnailUrl() == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "该素材没有缩略图");
        }
        Path file = resolveExisting(asset.thumbnailUrl(), "缩略图已丢失");
        // Spring 的 MediaType 没有 IMAGE_WEBP 常量；按其实际扩展名送，找不到就退回二进制流。
        String thumbnailName = asset.thumbnailUrl().toLowerCase();
        MediaType type = thumbnailName.endsWith(".png") ? MediaType.IMAGE_PNG
                : thumbnailName.endsWith(".jpg") || thumbnailName.endsWith(".jpeg") ? MediaType.IMAGE_JPEG
                : MediaType.parseMediaType("image/webp");
        return ResponseEntity.ok()
                .contentType(type)
                .body(new org.springframework.core.io.FileSystemResource(file));
    }

    private Path resolveExisting(String relative, String message) {
        if (relative == null || !storage.isInsideRoot(relative)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", message);
        }
        Path file = storage.resolve(relative);
        if (!Files.isReadable(file)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", message);
        }
        return file;
    }

    private static MediaType parseMediaType(String mimeType) {
        try {
            return mimeType == null ? MediaType.APPLICATION_OCTET_STREAM : MediaType.parseMediaType(mimeType);
        } catch (IllegalArgumentException ex) {
            return MediaType.APPLICATION_OCTET_STREAM;
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /**
     * 上传结果。
     *
     * <p>{@code deduped} 必须如实回传：命中去重时并没有新建素材，
     * 前端提示「已存在」而不是「已导入」，用户才不会以为多了一份。</p>
     *
     * @param asset   素材本体
     * @param deduped 是否命中去重
     */
    public record UploadResponse(AssetResponse asset, boolean deduped) {
    }

    /**
     * 分页结果。
     *
     * @param items    当前页
     * @param nextCursor 下一页游标；没有更多时为 null
     * @param total    满足条件的总数
     */
    public record PageResponse(List<AssetResponse> items, String nextCursor, int total) {
    }

    /**
     * 筛选面计数。
     *
     * @param total 总数
     */
    public record FacetsResponse(
            int total,
            java.util.Map<String, Integer> mediaTypes,
            java.util.Map<String, Integer> sourceTypes,
            java.util.Map<String, Integer> reviewStatus,
            java.util.Map<String, Integer> availability,
            java.util.Map<String, Integer> licenseStatus) {
    }

    /** 批量删除请求。 */
    public record BatchDeleteRequest(List<String> ids) {
    }

    /** 批量删除结果：逐项成功或失败，不合并成单一状态。 */
    public record BatchDeleteResponse(List<AssetService.DeleteItemResult> results) {
    }
}
