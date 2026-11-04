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
    private final ThumbnailService thumbnails;

    public AssetService(AssetRepository assets, AssetStorage storage, ResourceRefService refs,
            ThumbnailService thumbnails) {
        this.assets = assets;
        this.storage = storage;
        this.refs = refs;
        this.thumbnails = thumbnails;
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
        // 默认行为：同一内容只保留一条记录（用户重复拖同一个文件时不该出现两条）。
        return importFile(fileName, mimeType, folderId, name, stream, false);
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
            if (existing.isPresent() && !keepSeparateRecord) {
                Files.deleteIfExists(tmp);
                log.info("导入命中去重：{}（哈希 {}）", fileName, hash);
                // 去重不该吞掉用户这次的目标文件夹：用户把已存在的文件拖进「参考资料」，
                // 期待它出现在那里。若只返回旧记录，界面报「导入成功」而文件不在该文件夹，
                // 用户会以为拖拽失效。名称/标签不合并（那是用户各自的记录），只移动归属。
                return new ImportResult(placeInFolder(existing.get(), folderId), true);
            }
            if (existing.isPresent()) {
                // 显式要求保留独立记录：文件本体复用同一份（不重复落盘），
                // 但新建一条索引，让这条记录的名称/标签/文件夹能独立存在。
                Files.deleteIfExists(tmp);
                log.info("内容命中但保留独立记录：{}（哈希 {}）", fileName, hash);
                return new ImportResult(duplicateRecordOf(existing.get(), fileName, mimeType, folderId,
                        name, mediaType, hash, size), false);
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
     * 基于已有素材的文件，新建一条**独立的用户记录**。
     *
     * <p>文件本体复用同一份（`storagePath` 与 `contentHash` 相同，不占第二份磁盘），
     * 但 id、名称、标签、文件夹、授权、审核都独立 —— 这正是「去重文件、不合并记录」。</p>
     *
     * <p>`content_hash` 上**没有**唯一约束（见 schema.sql）：多条记录可以共享同一内容。
     * 去重由服务层保证 —— 文件只落盘一份，新记录直接复用已有记录的存储路径。</p>
     */
    private Asset duplicateRecordOf(Asset existing, String fileName, String mimeType, String folderId,
            String name, AssetStates.MediaType mediaType, String hash, long size) {
        Instant now = Instant.now();
        String id = "asset_" + UUID.randomUUID();
        Asset copy = new Asset(
                id,
                name == null || name.isBlank() ? fileName : name,
                mediaType,
                effectiveMimeType(fileName, mimeType, mediaType),
                size,
                AssetStates.SourceType.IMPORTED,
                existing.processingStatus(),
                existing.processingError(),
                AssetStates.ReviewStatus.NONE,
                AssetStates.Availability.ENABLED,
                AssetStates.LicenseStatus.UNKNOWN,
                null,
                existing.width(),
                existing.height(),
                existing.durationMs(),
                List.of(),
                folderId,
                // 复用同一份文件本体；缩略图也复用。
                existing.fileUrl(),
                existing.thumbnailUrl(),
                // 保留真实哈希：多条记录共享同一内容时都记同一个哈希，
                // 后续仍能按它找到可复用的文件本体。
                hash,
                now,
                now,
                null,
                id,
                false);
        return assets.save(copy);
    }

    /**
     * 生成缩略图，返回相对存储根的路径；失败返回 null。
     *
     * <p>与文件本体放在同一目录（{@code thumb.webp}），这样删素材时一次递归就能清干净，
     * 不需要维护第二套目录结构。</p>
     */
    private String generateThumbnail(Path targetDir, Path original, AssetStates.MediaType mediaType) {
        boolean generated = switch (mediaType) {
            case VIDEO -> thumbnails.extractVideoThumbnail(original, targetDir.resolve("thumb.webp"));
            case IMAGE -> thumbnails.extractImageThumbnail(original, targetDir.resolve("thumb.webp"));
            // 音频、字体、文档没有可用的画面。前端按类型显示图标即可，
            // 不为它们生成一张假图 —— 假缩略图比没有更糟。
            default -> false;
        };
        if (!generated) {
            return null;
        }
        Path relative = storage.root().relativize(targetDir.resolve("thumb.webp"));
        return relative.toString();
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

        // 探测元数据与生成缩略图。两者的失败都不影响导入：读不出就留空，
        // 界面显示「未知」/类型图标，而不是让整次导入失败。
        // 图片也要探测：宽高是用户会看的信息，缺了会显示成「未知」。
        // 音频也走 probe（它单独取容器时长，没有视频流时宽高为 null 是正常的）。
        ThumbnailService.MediaInfo info = switch (mediaType) {
            case VIDEO, AUDIO, IMAGE -> thumbnails.probe(target);
            default -> null;
        };
        // 图片没有时长。ffprobe 对 PNG 会报单帧时长（0.04s），那是技术值不是语义值，
        // 直接存下来会让界面显示「0:00」这种误导性的时长。
        if (info != null && mediaType == AssetStates.MediaType.IMAGE) {
            info = new ThumbnailService.MediaInfo(info.width(), info.height(), null);
        }
        String relativeThumb = generateThumbnail(targetDir, target, mediaType);

        // 处理状态如实反映实际结果：只有真的解析过才敢标 ready。
        // 什么都没解析出来时停在 pending —— 那表示「还没做」，不是「做失败了」。
        boolean parsed = info != null || relativeThumb != null;
        AssetStates.ProcessingStatus processing = parsed
                ? AssetStates.ProcessingStatus.READY
                : AssetStates.ProcessingStatus.PENDING;

        Asset asset = new Asset(
                id,
                name == null || name.isBlank() ? fileName : name,
                mediaType,
                effectiveMimeType(fileName, mimeType, mediaType),
                size,
                AssetStates.SourceType.IMPORTED,
                processing,
                null,
                // 从未提审 —— 注意不是 pending：pending 是「已提审」。
                AssetStates.ReviewStatus.NONE,
                AssetStates.Availability.ENABLED,
                // 没有可靠授权信息一律 unknown，不猜。
                AssetStates.LicenseStatus.UNKNOWN,
                null,
                info == null ? null : info.width(),
                info == null ? null : info.height(),
                info == null ? null : info.durationMs(),
                List.of(),
                folderId,
                relativeFile,
                relativeThumb,
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
    /**
     * 存下来的 MIME。
     *
     * <p>客户端没带类型（curl、部分拖拽、被标成 octet-stream）时，不能把
     * {@code application/octet-stream} 原样存进库：界面会显示一个对用户无意义的类型，
     * 而实际类型明明能从扩展名看出来。这里按已判定的媒体类型与扩展名补一个具体值。</p>
     */
    static String effectiveMimeType(String fileName, String mimeType, AssetStates.MediaType mediaType) {
        if (mimeType != null && !mimeType.isBlank()
                && !mimeType.equalsIgnoreCase("application/octet-stream")) {
            return mimeType;
        }
        String name = fileName == null ? "" : fileName.toLowerCase();
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1) : "";
        return switch (ext) {
            case "mp4", "m4v" -> "video/mp4";
            case "mov" -> "video/quicktime";
            case "mkv" -> "video/x-matroska";
            case "webm" -> "video/webm";
            case "avi" -> "video/x-msvideo";
            case "png" -> "image/png";
            case "jpg", "jpeg" -> "image/jpeg";
            case "gif" -> "image/gif";
            case "webp" -> "image/webp";
            case "svg" -> "image/svg+xml";
            case "avif" -> "image/avif";
            case "mp3" -> "audio/mpeg";
            case "wav" -> "audio/wav";
            case "flac" -> "audio/flac";
            case "aac", "m4a" -> "audio/aac";
            case "ogg" -> "audio/ogg";
            case "woff2" -> "font/woff2";
            case "woff" -> "font/woff";
            case "ttf" -> "font/ttf";
            case "otf" -> "font/otf";
            case "pdf" -> "application/pdf";
            case "md" -> "text/markdown";
            case "txt" -> "text/plain";
            case "json" -> "application/json";
            default -> switch (mediaType) {
                case VIDEO -> "video/mp4";
                case IMAGE -> "image/png";
                case AUDIO -> "audio/mpeg";
                case FONT -> "font/ttf";
                case DOC -> "application/octet-stream";
            };
        };
    }

    static AssetStates.MediaType mediaTypeOf(String fileName, String mimeType) {
        String mime = mimeType == null ? "" : mimeType.toLowerCase();
        String name = fileName.toLowerCase();
        // 先看 MIME，看不出来再看扩展名。只认 MIME 会误拒：
        // curl、部分桌面拖拽、以及被系统标成 application/octet-stream 的 mp4 都没有正确 MIME，
        // 而文件的扩展名是可靠的。
        if (mime.startsWith("image/") || name.matches(".*\\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)$")) {
            return AssetStates.MediaType.IMAGE;
        }
        if (mime.startsWith("video/") || name.matches(".*\\.(mp4|mov|mkv|webm|avi|m4v)$")) {
            return AssetStates.MediaType.VIDEO;
        }
        if (mime.startsWith("audio/") || name.matches(".*\\.(mp3|wav|flac|aac|m4a|ogg)$")) {
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
