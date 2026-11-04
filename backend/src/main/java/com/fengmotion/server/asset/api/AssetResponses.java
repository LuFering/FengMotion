package com.fengmotion.server.asset.api;

import java.util.List;

import org.springframework.stereotype.Component;

import com.fengmotion.server.asset.api.dto.AssetResponse;
import com.fengmotion.server.asset.api.dto.AssetResponse.RefResponse;
import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.asset.service.ResourceRefService;
import com.fengmotion.server.asset.store.mapper.ResourceRefMapper.RefRow;

/**
 * 领域对象 → 响应体。
 *
 * <p>单独成类是因为「引用方要不要查」是个明确取舍：列表接口逐条查引用会变成 N+1 查询，
 * 而素材列表动辄上百条。这里把取舍放在一处，调用方显式选择。</p>
 */
@Component
public class AssetResponses {

    private final ResourceRefService refs;

    public AssetResponses(ResourceRefService refs) {
        this.refs = refs;
    }

    /** 组装单个素材的响应。 */
    public AssetResponse of(Asset asset, boolean includeRefs) {
        List<RefResponse> refList = List.of();
        if (includeRefs) {
            refList = refs.find(ResourceRefService.KIND_ASSET, asset.id()).stream()
                    .map(AssetResponses::toRef)
                    .toList();
        }
        return new AssetResponse(
                asset.id(),
                asset.name(),
                asset.mediaType().wire(),
                asset.mimeType(),
                asset.sizeBytes(),
                asset.sourceType().wire(),
                asset.processingStatus().wire(),
                asset.processingError(),
                asset.reviewStatus().wire(),
                asset.availability().wire(),
                asset.licenseStatus().wire(),
                asset.licenseDetails(),
                asset.width(),
                asset.height(),
                asset.durationMs(),
                asset.tags(),
                asset.folderId(),
                // 相对路径而非绝对路径：Electron 与浏览器两种形态下由前端拼服务地址，
                // 后端把自己的监听端口写进响应会变成一条不可搬迁的绝对地址。
                asset.fileUrl() == null ? null : "/api/assets/" + asset.id() + "/content",
                asset.thumbnailUrl() == null ? null : "/api/assets/" + asset.id() + "/thumbnail",
                asset.createdAt() == null ? null : asset.createdAt().toString(),
                asset.updatedAt() == null ? null : asset.updatedAt().toString(),
                asset.lastUsedAt() == null ? null : asset.lastUsedAt().toString(),
                asset.etag(),
                refList,
                asset.demo());
    }

    private static RefResponse toRef(RefRow row) {
        return new RefResponse(row.getRefKind(), row.getRefId(), row.getRefLabel());
    }
}
