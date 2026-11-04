package com.fengmotion.server.asset.service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.asset.domain.AssetFolder;
import com.fengmotion.server.asset.store.AssetRepository;
import com.fengmotion.server.common.ApiException;

/**
 * 素材文件夹。
 *
 * <p>删除文件夹时素材移回根目录，不级联删除：素材是用户的真实文件，
 * 删掉一个用于组织的文件夹，不该顺手把文件也删了。</p>
 */
@Service
public class AssetFolderService {

    private final AssetRepository assets;

    public AssetFolderService(AssetRepository assets) {
        this.assets = assets;
    }

    /** 文件夹连同其素材数。 */
    public record FolderWithCount(AssetFolder folder, int assetCount) {
    }

    public List<FolderWithCount> list() {
        List<FolderWithCount> result = new ArrayList<>();
        for (AssetFolder folder : assets.listFolders()) {
            result.add(new FolderWithCount(folder, assets.countInFolder(folder.id())));
        }
        return result;
    }

    @Transactional
    public AssetFolder create(String name) {
        String trimmed = requireName(name);
        if (assets.findFolderByName(trimmed).isPresent()) {
            throw new ApiException(HttpStatus.CONFLICT, "folder_exists", "同名文件夹已存在");
        }
        Instant now = Instant.now();
        return assets.saveFolder(new AssetFolder("folder_" + UUID.randomUUID(), trimmed, now, now));
    }

    @Transactional
    public AssetFolder rename(String id, String name) {
        String trimmed = requireName(name);
        assets.findFolder(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "文件夹不存在"));
        assets.findFolderByName(trimmed)
                .filter(existing -> !existing.id().equals(id))
                .ifPresent(existing -> {
                    throw new ApiException(HttpStatus.CONFLICT, "folder_exists", "同名文件夹已存在");
                });
        return assets.renameFolder(id, trimmed)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "文件夹不存在"));
    }

    /** 删除文件夹；其中素材移回根目录。 */
    @Transactional
    public int delete(String id) {
        assets.findFolder(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "文件夹不存在"));
        int moved = assets.countInFolder(id);
        assets.moveFolderToRoot(id);
        assets.deleteFolder(id);
        return moved;
    }

    private static String requireName(String name) {
        if (name == null || name.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文件夹名不能为空");
        }
        return name.trim();
    }
}
