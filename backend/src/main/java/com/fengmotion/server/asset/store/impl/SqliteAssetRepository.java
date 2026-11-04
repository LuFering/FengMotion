package com.fengmotion.server.asset.store.impl;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.asset.domain.AssetFolder;
import com.fengmotion.server.asset.domain.AssetStates;
import com.fengmotion.server.asset.store.AssetCounts;
import com.fengmotion.server.asset.store.AssetQuery;
import com.fengmotion.server.asset.store.AssetRepository;
import com.fengmotion.server.asset.store.mapper.AssetFolderMapper;
import com.fengmotion.server.asset.store.mapper.AssetFolderRow;
import com.fengmotion.server.asset.store.mapper.AssetMapper;
import com.fengmotion.server.asset.store.mapper.AssetRow;

/**
 * 素材持久化的 SQLite 实现。
 *
 * <p>行 ↔ 领域对象的转换集中在这里：枚举用 wire 字符串落库（见 {@link AssetStates}），
 * 时间用 ISO-8601 文本，标签用 JSON 数组。Mapper 不碰这些转换，业务层也看不到裸字符串。</p>
 */
@Repository
public class SqliteAssetRepository implements AssetRepository {

    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {
    };

    private final AssetMapper assets;
    private final AssetFolderMapper folders;
    private final AssetCountsReader counts;
    private final ObjectMapper json;

    public SqliteAssetRepository(AssetMapper assets, AssetFolderMapper folders, AssetCountsReader counts,
            ObjectMapper json) {
        this.assets = assets;
        this.folders = folders;
        this.counts = counts;
        this.json = json;
    }

    @Override
    public Asset save(Asset asset) {
        AssetRow row = new AssetRow();
        row.setId(asset.id());
        row.setName(asset.name());
        row.setMediaType(asset.mediaType().wire());
        row.setMimeType(asset.mimeType());
        row.setSizeBytes(asset.sizeBytes());
        row.setSourceType(asset.sourceType().wire());
        row.setProcessingStatus(asset.processingStatus().wire());
        row.setProcessingError(asset.processingError());
        row.setReviewStatus(asset.reviewStatus().wire());
        row.setAvailability(asset.availability().wire());
        row.setLicenseStatus(asset.licenseStatus().wire());
        row.setLicenseDetails(asset.licenseDetails());
        row.setWidth(asset.width());
        row.setHeight(asset.height());
        row.setDurationMs(asset.durationMs());
        row.setTagsJson(writeTags(asset.tags()));
        row.setFolderId(asset.folderId());
        row.setStoragePath(asset.fileUrl());
        row.setThumbnailPath(asset.thumbnailUrl());
        row.setContentHash(asset.contentHash());
        row.setCreatedAt(asset.createdAt().toString());
        row.setUpdatedAt(asset.updatedAt().toString());
        row.setLastUsedAt(asset.lastUsedAt() == null ? null : asset.lastUsedAt().toString());
        row.setEtag(asset.etag());
        row.setDemo(asset.demo() ? 1 : 0);
        assets.insert(row);
        return asset;
    }

    @Override
    public Optional<Asset> findById(String id) {
        return Optional.ofNullable(assets.findById(id)).map(this::toAsset);
    }

    @Override
    public Optional<Asset> findByHash(String contentHash) {
        return Optional.ofNullable(assets.findByHash(contentHash)).map(this::toAsset);
    }

    @Override
    public int countSharingHash(String contentHash, String excludeId) {
        return assets.countSharingHash(contentHash, excludeId);
    }

    @Override
    public Optional<Asset> updateWithEtag(Asset asset, String expectedEtag) {
        AssetRow row = new AssetRow();
        row.setId(asset.id());
        row.setName(asset.name());
        row.setFolderId(asset.folderId());
        row.setTagsJson(writeTags(asset.tags()));
        row.setSourceType(asset.sourceType().wire());
        row.setProcessingStatus(asset.processingStatus().wire());
        row.setProcessingError(asset.processingError());
        row.setReviewStatus(asset.reviewStatus().wire());
        row.setAvailability(asset.availability().wire());
        row.setLicenseStatus(asset.licenseStatus().wire());
        row.setLicenseDetails(asset.licenseDetails());
        row.setLastUsedAt(asset.lastUsedAt() == null ? null : asset.lastUsedAt().toString());
        row.setUpdatedAt(asset.updatedAt().toString());
        row.setEtag(asset.etag());
        int updated = assets.updateWithEtag(row, expectedEtag);
        return updated == 0 ? Optional.empty() : findById(asset.id());
    }

    @Override
    public boolean deleteById(String id) {
        return assets.deleteById(id) > 0;
    }

    @Override
    public List<Asset> search(AssetQuery query) {
        List<AssetRow> rows = assets.search(
                wire(query.mediaType()), wire(query.sourceType()), wire(query.reviewStatus()),
                wire(query.availability()), wire(query.licenseStatus()), wire(query.processingStatus()),
                query.folderId(), query.rootOnly(), query.q(), query.qLike(), query.tag(), query.tagLike(),
                query.sort(), query.limit(), query.offset());
        List<Asset> result = new ArrayList<>(rows.size());
        for (AssetRow row : rows) {
            result.add(toAsset(row));
        }
        return result;
    }

    @Override
    public int count(AssetQuery query) {
        return assets.count(
                wire(query.mediaType()), wire(query.sourceType()), wire(query.reviewStatus()),
                wire(query.availability()), wire(query.licenseStatus()), wire(query.processingStatus()),
                query.folderId(), query.rootOnly(), query.q(), query.qLike(), query.tag(), query.tagLike());
    }

    @Override
    public AssetCounts counts() {
        return counts.read();
    }

    @Override
    public int countInFolder(String folderId) {
        return assets.countInFolder(folderId);
    }

    @Override
    public void moveFolderToRoot(String folderId) {
        assets.moveFolderToRoot(folderId, Instant.now().toString());
    }

    // ── 文件夹 ──

    @Override
    public AssetFolder saveFolder(AssetFolder folder) {
        AssetFolderRow row = new AssetFolderRow();
        row.setId(folder.id());
        row.setName(folder.name());
        row.setCreatedAt(folder.createdAt().toString());
        row.setUpdatedAt(folder.updatedAt().toString());
        folders.insert(row);
        return folder;
    }

    @Override
    public Optional<AssetFolder> findFolder(String id) {
        return Optional.ofNullable(folders.findById(id)).map(this::toFolder);
    }

    @Override
    public Optional<AssetFolder> findFolderByName(String name) {
        return Optional.ofNullable(folders.findByName(name)).map(this::toFolder);
    }

    @Override
    public List<AssetFolder> listFolders() {
        List<AssetFolder> result = new ArrayList<>();
        for (AssetFolderRow row : folders.findAll()) {
            result.add(toFolder(row));
        }
        return result;
    }

    @Override
    public Optional<AssetFolder> renameFolder(String id, String name) {
        return folders.rename(id, name, Instant.now().toString()) == 0 ? Optional.empty() : findFolder(id);
    }

    @Override
    public boolean deleteFolder(String id) {
        return folders.deleteById(id) > 0;
    }

    // ── 转换 ──

    private Asset toAsset(AssetRow row) {
        return new Asset(
                row.getId(),
                row.getName(),
                AssetStates.MediaType.fromWire(row.getMediaType()),
                row.getMimeType(),
                row.getSizeBytes() == null ? 0L : row.getSizeBytes(),
                AssetStates.SourceType.fromWire(row.getSourceType()),
                AssetStates.ProcessingStatus.fromWire(row.getProcessingStatus()),
                row.getProcessingError(),
                AssetStates.ReviewStatus.fromWire(row.getReviewStatus()),
                AssetStates.Availability.fromWire(row.getAvailability()),
                AssetStates.LicenseStatus.fromWire(row.getLicenseStatus()),
                row.getLicenseDetails(),
                row.getWidth(),
                row.getHeight(),
                row.getDurationMs(),
                readTags(row.getTagsJson()),
                row.getFolderId(),
                row.getStoragePath(),
                row.getThumbnailPath(),
                row.getContentHash(),
                parseInstant(row.getCreatedAt()),
                parseInstant(row.getUpdatedAt()),
                row.getLastUsedAt() == null ? null : parseInstant(row.getLastUsedAt()),
                row.getEtag(),
                row.getDemo() != null && row.getDemo() == 1);
    }

    private AssetFolder toFolder(AssetFolderRow row) {
        return new AssetFolder(
                row.getId(),
                row.getName(),
                parseInstant(row.getCreatedAt()),
                parseInstant(row.getUpdatedAt()));
    }

    // 每个枚举显式重载，而不是反射调 wire()：反射会在改名时静默失败，
    // 而这里编译期就能发现漏写的重载。
    private static String wire(AssetStates.MediaType value) {
        return value == null ? null : value.wire();
    }

    private static String wire(AssetStates.SourceType value) {
        return value == null ? null : value.wire();
    }

    private static String wire(AssetStates.ReviewStatus value) {
        return value == null ? null : value.wire();
    }

    private static String wire(AssetStates.Availability value) {
        return value == null ? null : value.wire();
    }

    private static String wire(AssetStates.LicenseStatus value) {
        return value == null ? null : value.wire();
    }

    private static String wire(AssetStates.ProcessingStatus value) {
        return value == null ? null : value.wire();
    }

    private String writeTags(List<String> tags) {
        try {
            return json.writeValueAsString(tags == null ? List.of() : tags);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException("标签序列化失败", ex);
        }
    }

    private List<String> readTags(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        try {
            return json.readValue(text, STRING_LIST);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            // 标签损坏不应让整条素材读不出来：返回空列表，元数据其余部分照常可用。
            return List.of();
        }
    }

    private static Instant parseInstant(String text) {
        return text == null ? null : Instant.parse(text);
    }
}
