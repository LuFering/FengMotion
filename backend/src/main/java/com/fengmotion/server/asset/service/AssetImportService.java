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
import com.fengmotion.server.asset.store.AssetRepository;
import com.fengmotion.server.common.ApiException;

@Service
public class AssetImportService {
    private static final Logger log = LoggerFactory.getLogger(AssetImportService.class);

    private final AssetRepository assets;
    private final AssetStorage storage;
    private final ThumbnailService thumbnails;

    public AssetImportService(AssetRepository assets, AssetStorage storage, ThumbnailService thumbnails) {
        this.assets = assets;
        this.storage = storage;
        this.thumbnails = thumbnails;
    }

    @Transactional
    public AssetService.ImportResult importFile(String fileName, String mimeType, String folderId, String name,
                                                InputStream stream, boolean keepSeparateRecord) {
        return importFile(fileName, mimeType, folderId, name, stream, keepSeparateRecord, null);
    }

    /**
     * 导入并归属到项目。
     *
     * @param projectId 归属项目；null 表示未归属。命中去重时只给「未归属」的已有素材补上项目，
     *                  已归属别的项目的素材不会因为另一个项目导入了同一文件而被改走。
     */
    @Transactional
    public AssetService.ImportResult importFile(String fileName, String mimeType, String folderId, String name,
                                                InputStream stream, boolean keepSeparateRecord, String projectId) {
        if (fileName == null || fileName.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文件名不能为空");
        }
        AssetStates.MediaType mediaType = AssetMediaTypes.mediaTypeOf(fileName, mimeType);
        if (mediaType == null) {
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type",
                    "暂不支持这种文件类型：" + fileName);
        }
        if (folderId != null && assets.findFolder(folderId).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "文件夹不存在");
        }
        if (projectId != null && !assets.projectExists(projectId)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在或已归档");
        }

        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            Path tmp = Files.createTempFile("fengmotion-upload-", ".bin");
            long size;
            String hash;
            try {
                size = copyAndDigest(stream, tmp, digest);
                hash = HexFormat.of().formatHex(digest.digest());
            } catch (IOException failure) {
                Files.deleteIfExists(tmp);
                throw failure;
            }

            Optional<Asset> existing = assets.findByHash(hash);
            boolean canReuse = existing.isPresent() && fileUsable(existing.get());
            if (existing.isPresent() && !canReuse) {
                log.warn("命中已有记录但文件不可用，将重新落盘：{}（哈希 {}）", fileName, hash);
                existing = Optional.empty();
            }
            if (existing.isPresent() && !keepSeparateRecord) {
                Files.deleteIfExists(tmp);
                log.info("导入命中去重：{}（哈希 {}）", fileName, hash);
                return new AssetService.ImportResult(placeInFolder(existing.get(), folderId, projectId), true);
            }
            if (existing.isPresent()) {
                Files.deleteIfExists(tmp);
                log.info("内容命中但保留独立记录：{}（哈希 {}）", fileName, hash);
                return new AssetService.ImportResult(duplicateRecordOf(existing.get(), fileName, mimeType,
                        folderId, name, mediaType, hash, size, projectId), false);
            }
            if (size == 0) {
                Files.deleteIfExists(tmp);
                throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文件内容为空");
            }
            return new AssetService.ImportResult(persist(tmp, fileName, mimeType, folderId, name,
                    mediaType, hash, size, projectId), false);
        } catch (IOException failure) {
            log.error("导入文件失败：{}", fileName, failure);
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "文件保存失败");
        } catch (NoSuchAlgorithmException failure) {
            throw new IllegalStateException("运行环境缺少 SHA-256", failure);
        }
    }

    private boolean fileUsable(Asset asset) {
        String url = asset.fileUrl();
        if (url == null || url.isBlank()) {
            return false;
        }
        try {
            Path file = storage.resolve(url);
            return Files.isRegularFile(file) && Files.size(file) > 0;
        } catch (IllegalArgumentException failure) {
            log.warn("素材文件路径无效：{}", url, failure);
            return false;
        } catch (IOException failure) {
            log.warn("检查素材文件失败：{}", url, failure);
            return false;
        }
    }

    private Asset duplicateRecordOf(Asset existing, String fileName, String mimeType, String folderId,
                                    String name, AssetStates.MediaType mediaType, String hash, long size,
                                    String projectId) {
        Instant now = Instant.now();
        String id = "asset_" + UUID.randomUUID();
        Asset copy = new Asset(
                id,
                name == null || name.isBlank() ? fileName : name,
                mediaType,
                AssetMediaTypes.effectiveMimeType(fileName, mimeType, mediaType),
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
                existing.fileUrl(),
                existing.thumbnailUrl(),
                hash,
                now,
                now,
                null,
                id,
                false,
                projectId);
        return assets.save(copy);
    }

    /**
     * 命中去重时把已有素材放到这次导入的位置：文件夹跟随这次导入；
     * 项目只在已有素材未归属时补上，不把别的项目的素材改走。
     */
    private Asset placeInFolder(Asset existing, String folderId, String projectId) {
        boolean moveFolder = folderId != null && !folderId.equals(existing.folderId());
        boolean claimProject = projectId != null && existing.projectId() == null;
        if (!moveFolder && !claimProject) {
            return existing;
        }
        Instant now = Instant.now();
        Asset moved = new Asset(
                existing.id(), existing.name(), existing.mediaType(), existing.mimeType(),
                existing.sizeBytes(), existing.sourceType(), existing.processingStatus(),
                existing.processingError(), existing.reviewStatus(), existing.availability(),
                existing.licenseStatus(), existing.licenseDetails(), existing.width(), existing.height(),
                existing.durationMs(), existing.tags(), moveFolder ? folderId : existing.folderId(),
                existing.fileUrl(), existing.thumbnailUrl(), existing.contentHash(), existing.createdAt(), now,
                existing.lastUsedAt(), "v" + UUID.randomUUID(), existing.demo(),
                claimProject ? projectId : existing.projectId());
        return assets.updateWithEtag(moved, existing.etag()).orElse(existing);
    }

    private Asset persist(Path tmp, String fileName, String mimeType, String folderId, String name,
                          AssetStates.MediaType mediaType, String hash, long size,
                          String projectId) throws IOException {
        String relativeDir = storage.relativeDirFor(hash);
        Path targetDir = storage.resolve(relativeDir);
        Files.createDirectories(targetDir);
        String extension = AssetMediaTypes.extensionOf(fileName);
        Path target = targetDir.resolve("original" + extension);
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);

        Instant now = Instant.now();
        String id = "asset_" + UUID.randomUUID();
        String relativeFile = Path.of(relativeDir, "original" + extension).toString();
        ThumbnailService.MediaInfo info = switch (mediaType) {
            case VIDEO, AUDIO, IMAGE -> thumbnails.probe(target);
            default -> null;
        };
        if (info != null && mediaType == AssetStates.MediaType.IMAGE) {
            info = new ThumbnailService.MediaInfo(info.width(), info.height(), null);
        }
        String relativeThumb = generateThumbnail(targetDir, target, mediaType);
        boolean parsed = info != null || relativeThumb != null;
        AssetStates.ProcessingStatus processing = parsed
                ? AssetStates.ProcessingStatus.READY
                : AssetStates.ProcessingStatus.PENDING;

        Asset asset = new Asset(
                id,
                name == null || name.isBlank() ? fileName : name,
                mediaType,
                AssetMediaTypes.effectiveMimeType(fileName, mimeType, mediaType),
                size,
                AssetStates.SourceType.IMPORTED,
                processing,
                null,
                AssetStates.ReviewStatus.NONE,
                AssetStates.Availability.ENABLED,
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
                false,
                projectId);
        return assets.save(asset);
    }

    private String generateThumbnail(Path targetDir, Path original, AssetStates.MediaType mediaType) {
        boolean generated = switch (mediaType) {
            case VIDEO -> thumbnails.extractVideoThumbnail(original, targetDir.resolve("thumb.webp"));
            case IMAGE -> thumbnails.extractImageThumbnail(original, targetDir.resolve("thumb.webp"));
            default -> false;
        };
        if (!generated) {
            return null;
        }
        Path relative = storage.root().relativize(targetDir.resolve("thumb.webp"));
        return relative.toString();
    }

    private static long copyAndDigest(InputStream in, Path target, MessageDigest digest) throws IOException {
        try (DigestInputStream dis = new DigestInputStream(in, digest)) {
            return Files.copy(dis, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
