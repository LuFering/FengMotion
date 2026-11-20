package com.fengmotion.server.asset.service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.asset.domain.AssetStates;
import com.fengmotion.server.asset.store.AssetCounts;
import com.fengmotion.server.asset.store.AssetQuery;
import com.fengmotion.server.asset.store.AssetRepository;
import com.fengmotion.server.asset.store.mapper.ResourceRefMapper.RefRow;
import com.fengmotion.server.common.ApiException;

/**
 * 素材库业务规则。
 *
 * <p>这一层承担的判断，都不能交给前端：
 * <ul>
 *   <li>文件大小由服务端实测，不信前端声明的 sizeBytes；</li>
 *   <li>审核状态只能按转换表走，且永不改动授权状态；</li>
 *   <li>删除前查引用，有引用就 409 并列出引用方；</li>
 *   <li>停用/弃用的素材禁止新增引用。</li>
 * </ul>
 */
@Service
public class AssetService {

    private static final Logger log = LoggerFactory.getLogger(AssetService.class);

    private final AssetRepository assets;
    private final AssetStorage storage;
    private final ResourceRefService refs;
    private final AssetImportService importer;

    @Autowired
    public AssetService(AssetRepository assets, AssetStorage storage, ResourceRefService refs,
                        ThumbnailService thumbnails, AssetImportService importer) {
        this.assets = assets;
        this.storage = storage;
        this.refs = refs;
        this.importer = importer;
    }

    public AssetService(AssetRepository assets, AssetStorage storage, ResourceRefService refs,
                        ThumbnailService thumbnails) {
        this(assets, storage, refs, thumbnails, new AssetImportService(assets, storage, thumbnails));
    }

    /** 导入结果：素材本体 + 是否命中去重。 */
    public record ImportResult(Asset asset, boolean deduped) {
    }

    /**
     * 把上传的字节流复制入库并建立索引。
     *
     * <p>复制入库而不是引用原路径（对账决定 C）：原文件之后被移动或删除不会让素材静默失效。
     * 若内容哈希已存在，返回已有素材并把用户新填的名称/标签作为**独立记录**的补充 ——
     * 不合并用户记录，否则两个人给同一个文件起的名字会互相覆盖。</p>
     *
     * @param fileName  原始文件名，用于推断媒体类型与展示名
     * @param mimeType  MIME
     * @param folderId  目标文件夹，可为 null
     * @param name      展示名，为空时用文件名
     * @param stream    文件内容
     * @return 导入结果
     */
    @Transactional
    public ImportResult importFile(String fileName, String mimeType, String folderId, String name,
            InputStream stream) {
        return importer.importFile(fileName, mimeType, folderId, name, stream, false);
    }

    /**
     * 导入，可选择「即使内容相同也保留独立记录」。
     *
     * <p>为什么需要这个选项：文件本体可以去重（磁盘只存一份），但**用户记录不该被合并**。
     * 旧库里完全可能存在两条内容相同、名称/标签/授权/文件夹不同的记录
     * （同一个人导了两次、分别打了不同标签）。迁移时如果按哈希直接返回已有记录，
     * 第二条的名称与标签就永久丢了，而用户看到的却是「迁移完成」。</p>
     *
     * <p>保留独立记录时，文件本体仍指向同一个哈希目录，不额外占磁盘 ——
     * 去重的是文件，不是用户记录。</p>
     *
     * @param keepSeparateRecord true 表示即使命中去重也新建一条记录
     */
    @Transactional
    public ImportResult importFile(String fileName, String mimeType, String folderId, String name,
            InputStream stream, boolean keepSeparateRecord) {
        return importer.importFile(fileName, mimeType, folderId, name, stream, keepSeparateRecord);
    }

    /**
     * 更新素材的用户可改字段。
     *
     * <p>审核与授权**分开处理**：这里允许同时改，但两者互不推断 ——
     * 把审核改成 approved 不会动 licenseStatus。</p>
     *
     * @param etag 客户端上次读到的 etag；不匹配返回 409
     */
    @Transactional
    public Asset update(String id, com.fengmotion.server.asset.api.dto.UpdateAssetRequest request, String etag) {
        Asset current = assets.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "素材不存在"));

        if (request.reviewStatus() != null && !current.reviewStatus().canTransitionTo(request.reviewStatus())) {
            throw new ApiException(HttpStatus.CONFLICT, "invalid_review_transition",
                    "审核状态不能从 " + current.reviewStatus().wire() + " 直接变为 "
                            + request.reviewStatus().wire());
        }
        // 契约 asset.md §3.4：审核通过要求已处理完成。
        AssetStates.ProcessingStatus nextProcessing = request.processingStatus() == null
                ? current.processingStatus()
                : request.processingStatus();
        AssetStates.ReviewStatus nextReview = request.reviewStatus() == null
                ? current.reviewStatus()
                : request.reviewStatus();
        if (nextReview == AssetStates.ReviewStatus.APPROVED
                && nextProcessing != AssetStates.ProcessingStatus.READY) {
            throw new ApiException(HttpStatus.CONFLICT, "review_requires_ready",
                    "素材处理完成后才能通过审核");
        }
        AssetStates.Availability nextAvailability = request.availability() == null
                ? current.availability()
                : request.availability();
        if (current.availability() == AssetStates.Availability.DEPRECATED
                && nextAvailability != AssetStates.Availability.DEPRECATED) {
            throw new ApiException(HttpStatus.CONFLICT, "deprecated_is_final", "弃用是终态，不能改回");
        }
        if (request.movesFolder() && request.targetFolderId() != null
                && assets.findFolder(request.targetFolderId()).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "文件夹不存在");
        }

        Instant now = Instant.now();
        Asset updated = new Asset(
                current.id(),
                request.name() == null ? current.name() : request.name(),
                current.mediaType(),
                current.mimeType(),
                current.sizeBytes(),
                current.sourceType(),
                nextProcessing,
                request.processingError() == null ? current.processingError() : request.processingError(),
                nextReview,
                nextAvailability,
                // 授权独立：请求没带就保持原值。
                request.licenseStatus() == null ? current.licenseStatus() : request.licenseStatus(),
                request.licenseDetails() == null ? current.licenseDetails() : request.licenseDetails(),
                current.width(),
                current.height(),
                current.durationMs(),
                request.tags() == null ? current.tags() : request.tags(),
                // folderId 三态：null=不改，空串=移回根目录，非空=移到该文件夹。
                // 只用「可空字符串」会把「移回根」误当成「不改」。
                request.movesFolder() ? request.targetFolderId() : current.folderId(),
                current.fileUrl(),
                current.thumbnailUrl(),
                current.contentHash(),
                current.createdAt(),
                now,
                request.touchLastUsed() ? now : current.lastUsedAt(),
                "v" + UUID.randomUUID(),
                current.demo());
        return assets.updateWithEtag(updated, etag == null ? current.etag() : etag)
                .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "etag_mismatch",
                        "素材已被其他操作修改，请刷新后重试"));
    }

    /**
     * 删除素材。
     *
     * <p>被引用时返回 409 并列出引用方，不静默级联 —— 用户需要知道「谁还在用」，
     * 才能决定先去解绑还是直接放弃删除。</p>
     */
    @Transactional
    public void delete(String id) {
        Asset current = assets.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "素材不存在"));
        List<RefRow> references = refs.find(ResourceRefService.KIND_ASSET, id);
        if (!references.isEmpty()) {
            throw new ApiException(HttpStatus.CONFLICT, "asset_in_use",
                    "素材正被 " + references.size() + " 处引用，删除前请先解除引用");
        }
        assets.deleteById(id);
        refs.clear(ResourceRefService.KIND_ASSET, id);
        /* 文件本体最后删：库里删成功但文件删失败，最坏是留个孤儿文件；
           反过来则是「记录还在但文件没了」，那会让素材打不开。

           但「同内容多记录」（keepSeparateRecord）只让记录各自独立，磁盘上是同一份文件。
           这时先删的那条若把目录整个删掉，另一条记录就变成打不开的空壳 ——
           所以要先确认自己是不是最后一个使用者。 */
        if (current.contentHash() != null && assets.countSharingHash(current.contentHash(), id) > 0) {
            log.info("删除素材记录但保留文件：仍有其他记录共用内容哈希 {}", current.contentHash());
            return;
        }
        try {
            Path dir = storage.resolve(storage.relativeDirFor(current.contentHash() == null
                    ? id : current.contentHash()));
            deleteRecursively(dir);
        } catch (IOException | IllegalArgumentException ex) {
            log.warn("删除素材文件失败（索引已删）：{}", id, ex);
        }
    }

    /** 批量删除：逐项报告成功或失败，不因一条失败而整体回滚。 */
    @Transactional
    public List<DeleteItemResult> deleteMany(List<String> ids) {
        List<DeleteItemResult> results = new ArrayList<>(ids.size());
        for (String id : ids) {
            try {
                delete(id);
                results.add(new DeleteItemResult(id, true, null));
            } catch (ApiException ex) {
                results.add(new DeleteItemResult(id, false, ex.getMessage()));
            }
        }
        return results;
    }

    /** 批量删除的逐项结果。 */
    public record DeleteItemResult(String id, boolean ok, String error) {
    }

    public Asset require(String id) {
        return assets.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "素材不存在"));
    }

    public List<Asset> search(AssetQuery query) {
        return assets.search(query);
    }

    public int count(AssetQuery query) {
        return assets.count(query);
    }

    public AssetCounts counts() {
        return assets.counts();
    }

    private static void deleteRecursively(Path dir) throws IOException {
        if (!Files.exists(dir)) {
            return;
        }
        try (var walk = Files.walk(dir)) {
            List<Path> paths = walk.sorted(java.util.Comparator.reverseOrder()).toList();
            for (Path path : paths) {
                Files.deleteIfExists(path);
            }
        }
    }

    static String effectiveMimeType(String fileName, String mimeType, AssetStates.MediaType mediaType) {
        return AssetMediaTypes.effectiveMimeType(fileName, mimeType, mediaType);
    }

    static AssetStates.MediaType mediaTypeOf(String fileName, String mimeType) {
        return AssetMediaTypes.mediaTypeOf(fileName, mimeType);
    }
}
