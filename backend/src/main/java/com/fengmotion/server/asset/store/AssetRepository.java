package com.fengmotion.server.asset.store;

import java.util.List;
import java.util.Optional;

import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.asset.domain.AssetFolder;

/**
 * 素材持久化边界。
 *
 * <p>服务层只依赖本接口，不直接碰 MyBatis Mapper：这样引用检查、乐观锁等规则
 * 集中在服务层，换存储实现不会牵动业务规则。</p>
 */
public interface AssetRepository {

    Asset save(Asset asset);

    Optional<Asset> findById(String id);

    /** 按内容哈希查同一文件本体；用于去重（不合并用户记录）。 */
    Optional<Asset> findByHash(String contentHash);

    /**
     * 除指定记录外，还有多少条记录共用这个内容哈希。
     *
     * <p>删除素材时用它判断「是不是最后一个使用者」：同内容的记录只在数据库里
     * 各自独立，磁盘上是同一份文件，先删的那条不能把文件一起带走。</p>
     *
     * @param contentHash 内容哈希
     * @param excludeId   正在删除的记录 ID
     * @return 其他共用者数量
     */
    int countSharingHash(String contentHash, String excludeId);

    /**
     * 带 etag 的条件更新。
     *
     * @return 更新后的素材；etag 不匹配时返回 {@link Optional#empty()}
     */
    Optional<Asset> updateWithEtag(Asset asset, String expectedEtag);

    boolean deleteById(String id);

    List<Asset> search(AssetQuery query);

    int count(AssetQuery query);

    /** 全量计数，不受筛选影响（facets 用）。 */
    AssetCounts counts();

    int countInFolder(String folderId);

    void moveFolderToRoot(String folderId);

    // ── 文件夹 ──

    AssetFolder saveFolder(AssetFolder folder);

    Optional<AssetFolder> findFolder(String id);

    Optional<AssetFolder> findFolderByName(String name);

    List<AssetFolder> listFolders();

    Optional<AssetFolder> renameFolder(String id, String name);

    boolean deleteFolder(String id);
}
