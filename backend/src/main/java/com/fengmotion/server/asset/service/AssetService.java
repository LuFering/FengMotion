package com.fengmotion.server.asset.service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

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

    public AssetService(AssetRepository assets, AssetStorage storage, ResourceRefService refs) {
        this.assets = assets;
        this.storage = storage;
        this.refs = refs;
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
        if (fileName == null || fileName.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文件名不能为空");
        }
        AssetStates.MediaType mediaType = mediaTypeOf(fileName, mimeType);
        if (mediaType == null) {
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type",
                    "暂不支持这种文件类型：" + fileName);
        }
        if (folderId != null && assets.findFolder(folderId).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "文件夹不存在");
        }

        String hash;
        long size;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            // 先写临时文件再按哈希归档：边读边算哈希，避免把整个文件读进内存。
            Path tmp = Files.createTempFile("fengmotion-upload-", ".bin");
            try {
                size = copyAndDigest(stream, tmp, digest);
                hash = HexFormat.of().formatHex(digest.digest());
            } catch (IOException ex) {
                Files.deleteIfExists(tmp);
                throw ex;
            }
            Optional<Asset> existing = assets.findByHash(hash);
            if (existing.isPresent()) {
                Files.deleteIfExists(tmp);
                log.info("导入命中去重：{}（哈希 {}）", fileName, hash);
                // 去重不该吞掉用户这次的目标文件夹：用户把已存在的文件拖进「参考资料」，
                // 期待它出现在那里。若只返回旧记录，界面报「导入成功」而文件不在该文件夹，
                // 用户会以为拖拽失效。名称/标签不合并（那是用户各自的记录），只移动归属。
                return new ImportResult(placeInFolder(existing.get(), folderId), true);
            }
            if (size == 0) {
                Files.deleteIfExists(tmp);
                throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文件内容为空");
            }
            return new ImportResult(persist(tmp, fileName, mimeType, folderId, name, mediaType, hash, size), false);
        } catch (IOException ex) {
            log.error("导入文件失败：{}", fileName, ex);
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "文件保存失败");
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("运行环境缺少 SHA-256", ex);
        }
    }

    /**
     * 把已存在的素材放到用户这次指定的文件夹。
     *
     * <p>只在用户显式指定了文件夹、且与当前归属不同时才移动；其余字段（名称/标签/授权）
     * 一律不动 —— 那是用户自己的记录，不该因为别人又导入了一次同一个文件而被改写。</p>
     */
    private Asset placeInFolder(Asset existing, String folderId) {
        if (folderId == null || folderId.equals(existing.folderId())) {
            return existing;
        }
        Instant now = Instant.now();
        Asset moved = new Asset(
                existing.id(), existing.name(), existing.mediaType(), existing.mimeType(),
                existing.sizeBytes(), existing.sourceType(), existing.processingStatus(),
                existing.processingError(), existing.reviewStatus(), existing.availability(),
                existing.licenseStatus(), existing.licenseDetails(), existing.width(), existing.height(),
                existing.durationMs(), existing.tags(), folderId, existing.fileUrl(),
                existing.thumbnailUrl(), existing.contentHash(), existing.createdAt(), now,
                existing.lastUsedAt(), "v" + UUID.randomUUID(), existing.demo());
        return assets.updateWithEtag(moved, existing.etag()).orElse(existing);
    }

    private Asset persist(Path tmp, String fileName, String mimeType, String folderId, String name,
            AssetStates.MediaType mediaType, String hash, long size) throws IOException {
        String relativeDir = storage.relativeDirFor(hash);
        Path targetDir = storage.resolve(relativeDir);
        Files.createDirectories(targetDir);
        String extension = extensionOf(fileName);
        Path target = targetDir.resolve("original" + extension);
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);

        Instant now = Instant.now();
        String id = "asset_" + UUID.randomUUID();
        String relativeFile = Path.of(relativeDir, "original" + extension).toString();
        Asset asset = new Asset(
                id,
                name == null || name.isBlank() ? fileName : name,
                mediaType,
                mimeType == null || mimeType.isBlank() ? "application/octet-stream" : mimeType,
                size,
                AssetStates.SourceType.IMPORTED,
                // 新导入的素材还没解析过尺寸/时长/缩略图，如实停在 pending。
                AssetStates.ProcessingStatus.PENDING,
                null,
                // 从未提审 —— 注意不是 pending：pending 是「已提审」。
                AssetStates.ReviewStatus.NONE,
                AssetStates.Availability.ENABLED,
                // 没有可靠授权信息一律 unknown，不猜。
                AssetStates.LicenseStatus.UNKNOWN,
                null,
                null,
                null,
                null,
                List.of(),
                folderId,
                relativeFile,
                null,
                hash,
                now,
                now,
                null,
                id,
                false);
        return assets.save(asset);
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
        if (request.folderId() != null && assets.findFolder(request.folderId()).isEmpty()) {
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
                request.folderId() == null ? current.folderId() : request.folderId(),
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
        // 文件本体最后删：库里删成功但文件删失败，最坏是留个孤儿文件；
        // 反过来则是「记录还在但文件没了」，那会让素材打不开。
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

    private static long copyAndDigest(InputStream in, Path target, MessageDigest digest) throws IOException {
        try (DigestInputStream dis = new DigestInputStream(in, digest)) {
            return Files.copy(dis, target, StandardCopyOption.REPLACE_EXISTING);
        }
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

    private static String extensionOf(String fileName) {
        int dot = fileName.lastIndexOf('.');
        if (dot < 0 || dot == fileName.length() - 1) {
            return "";
        }
        String ext = fileName.substring(dot).toLowerCase();
        // 扩展名只保留安全字符，避免文件名里带路径分隔符时写出目录。
        return ext.matches("\\.[a-z0-9]{1,10}") ? ext : "";
    }

    /**
     * 由文件名与 MIME 推断媒体类型。
     *
     * <p>契约 asset.md 的素材页要覆盖图片/视频/音频/字体/文档五类，
     * 所以这里比对话附件上传的类型范围更宽（附件只收图片/视频/音频）。</p>
     */
    static AssetStates.MediaType mediaTypeOf(String fileName, String mimeType) {
        String mime = mimeType == null ? "" : mimeType.toLowerCase();
        String name = fileName.toLowerCase();
        if (mime.startsWith("image/")) {
            return AssetStates.MediaType.IMAGE;
        }
        if (mime.startsWith("video/")) {
            return AssetStates.MediaType.VIDEO;
        }
        if (mime.startsWith("audio/")) {
            return AssetStates.MediaType.AUDIO;
        }
        if (mime.startsWith("font/") || name.matches(".*\\.(woff2?|ttf|otf)$")) {
            return AssetStates.MediaType.FONT;
        }
        if (mime.equals("application/pdf") || name.matches(".*\\.(pdf|md|txt|docx?|json)$")) {
            return AssetStates.MediaType.DOC;
        }
        return null;
    }
}
