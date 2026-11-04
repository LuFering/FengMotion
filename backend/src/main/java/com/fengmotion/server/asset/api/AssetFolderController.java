package com.fengmotion.server.asset.api;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.asset.domain.AssetFolder;
import com.fengmotion.server.asset.service.AssetFolderService;

/**
 * 素材文件夹接口（契约 asset.md §3.5）。
 *
 * <p>删除文件夹返回 {@code movedAssets}：告诉用户「有 N 个素材被移回根目录」，
 * 而不是静默处理。用户需要知道自己的素材去哪了。</p>
 */
@RestController
@RequestMapping("/api/asset-folders")
public class AssetFolderController {

    private final AssetFolderService folders;

    public AssetFolderController(AssetFolderService folders) {
        this.folders = folders;
    }

    /** 文件夹列表，含每个文件夹的素材数。 */
    @GetMapping
    public List<FolderResponse> list() {
        return folders.list().stream()
                .map(item -> new FolderResponse(item.folder(), item.assetCount()))
                .toList();
    }

    /** 新建文件夹。 */
    @PostMapping
    public ResponseEntity<FolderResponse> create(@RequestBody NameRequest request) {
        AssetFolder folder = folders.create(request == null ? null : request.name());
        return ResponseEntity.status(HttpStatus.CREATED).body(new FolderResponse(folder, 0));
    }

    /** 重命名。 */
    @PatchMapping("/{folderId}")
    public FolderResponse rename(@PathVariable String folderId, @RequestBody NameRequest request) {
        AssetFolder folder = folders.rename(folderId, request == null ? null : request.name());
        return new FolderResponse(folder, 0);
    }

    /** 删除文件夹；其中素材移回根目录，不级联删除。 */
    @DeleteMapping("/{folderId}")
    public DeleteResponse delete(@PathVariable String folderId) {
        return new DeleteResponse(folderId, folders.delete(folderId));
    }

    /** 新建/改名请求。 */
    public record NameRequest(String name) {
    }

    /**
     * 文件夹响应。
     *
     * @param id         文件夹 ID
     * @param name       名称
     * @param createdAt  创建时间
     * @param updatedAt  更新时间
     * @param assetCount 其中素材数
     */
    public record FolderResponse(String id, String name, String createdAt, String updatedAt, int assetCount) {
        FolderResponse(AssetFolder folder, int assetCount) {
            this(folder.id(), folder.name(), folder.createdAt().toString(), folder.updatedAt().toString(),
                    assetCount);
        }
    }

    /**
     * 删除结果。
     *
     * @param id          被删文件夹
     * @param movedAssets 被移回根目录的素材数
     */
    public record DeleteResponse(String id, int movedAssets) {
    }
}
