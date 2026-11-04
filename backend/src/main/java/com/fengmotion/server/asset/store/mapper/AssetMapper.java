package com.fengmotion.server.asset.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * assets 表读写。
 *
 * <p>检索口径（第一阶段，见 docs/contracts/对账-三库.md §4.1）：结构化筛选 + 中文子串匹配，
 * <strong>不上 FTS5</strong>。SQLite 的默认全文索引对中文分词并不可靠，效果必须先用真实
 * 查询压测；在此之前用 {@code LIKE '%q%'} 的语义是确定的（字面包含），不会给出「搜不到但
 * 其实存在」的结果。</p>
 *
 * <p>{@code q} 只匹配名称与标签，不搜 OCR/台词（契约 asset.md §3.1）。</p>
 */
@Mapper
public interface AssetMapper {

    @Insert("""
            INSERT INTO assets
                (id, name, media_type, mime_type, size_bytes, source_type, processing_status,
                 processing_error, review_status, availability, license_status, license_details,
                 width, height, duration_ms, tags_json, folder_id, storage_path, thumbnail_path,
                 content_hash, created_at, updated_at, last_used_at, etag, demo)
            VALUES
                (#{id}, #{name}, #{mediaType}, #{mimeType}, #{sizeBytes}, #{sourceType}, #{processingStatus},
                 #{processingError}, #{reviewStatus}, #{availability}, #{licenseStatus}, #{licenseDetails},
                 #{width}, #{height}, #{durationMs}, #{tagsJson}, #{folderId}, #{storagePath}, #{thumbnailPath},
                 #{contentHash}, #{createdAt}, #{updatedAt}, #{lastUsedAt}, #{etag}, #{demo})
            """)
    void insert(AssetRow row);

    @Select("SELECT * FROM assets WHERE id = #{id}")
    AssetRow findById(@Param("id") String id);

    /** 同一内容哈希是否已入库；用于去重，不合并用户记录（名称/标签/授权各自独立）。 */
    @Select("SELECT * FROM assets WHERE content_hash = #{contentHash} LIMIT 1")
    AssetRow findByHash(@Param("contentHash") String contentHash);

    /**
     * 除某条记录外，还有多少条记录共用这个内容哈希。
     *
     * <p>内容相同但元数据不同的记录各自独立存在，却共用同一份文件本体
     * （同一个存储目录）。所以删除某条记录时，只有它是最后一个使用者才能删文件 ——
     * 否则会把另一条记录的文件一起删掉，那条记录从此打不开。</p>
     *
     * @param contentHash 内容哈希
     * @param excludeId   正在删除的记录 ID
     * @return 其他共用者数量
     */
    @Select("SELECT COUNT(*) FROM assets WHERE content_hash = #{contentHash} AND id <> #{excludeId}")
    int countSharingHash(@Param("contentHash") String contentHash, @Param("excludeId") String excludeId);

    /**
     * 条件更新。{@code etag} 是乐观锁：不匹配则不更新，由服务层转成 409。
     *
     * @return 受影响行数；0 表示 etag 不匹配或记录已不存在
     */
    @Update("""
            UPDATE assets SET
                name = #{row.name}, folder_id = #{row.folderId}, tags_json = #{row.tagsJson},
                source_type = #{row.sourceType}, processing_status = #{row.processingStatus},
                processing_error = #{row.processingError}, review_status = #{row.reviewStatus},
                availability = #{row.availability}, license_status = #{row.licenseStatus},
                license_details = #{row.licenseDetails}, last_used_at = #{row.lastUsedAt},
                updated_at = #{row.updatedAt}, etag = #{row.etag}
            WHERE id = #{row.id} AND etag = #{expectedEtag}
            """)
    int updateWithEtag(@Param("row") AssetRow row, @Param("expectedEtag") String expectedEtag);

    @Delete("DELETE FROM assets WHERE id = #{id}")
    int deleteById(@Param("id") String id);

    @Select("SELECT COUNT(*) FROM assets WHERE folder_id = #{folderId}")
    int countInFolder(@Param("folderId") String folderId);

    /** 把某文件夹下的素材移回根（删除文件夹时用，不级联删素材）。 */
    @Update("UPDATE assets SET folder_id = NULL, updated_at = #{updatedAt} WHERE folder_id = #{folderId}")
    int moveFolderToRoot(@Param("folderId") String folderId, @Param("updatedAt") String updatedAt);

    /**
     * 列表查询：结构化筛选 + 中文子串匹配 + 游标分页。
     *
     * <p>排序用 {@code LIMIT/OFFSET}，游标是偏移量（与项目列表一致），
     * 偏移量在服务层已校验过范围。</p>
     */
    @Select("""
            <script>
            SELECT * FROM assets
            <where>
              <if test="mediaType != null">AND media_type = #{mediaType}</if>
              <if test="sourceType != null">AND source_type = #{sourceType}</if>
              <if test="reviewStatus != null">AND review_status = #{reviewStatus}</if>
              <if test="availability != null">AND availability = #{availability}</if>
              <if test="licenseStatus != null">AND license_status = #{licenseStatus}</if>
              <if test="processingStatus != null">AND processing_status = #{processingStatus}</if>
              <if test="folderId != null">AND folder_id = #{folderId}</if>
              <if test="rootOnly">AND folder_id IS NULL</if>
              <if test="q != null">AND (name LIKE #{qLike} OR tags_json LIKE #{qLike})</if>
              <if test="tag != null">AND tags_json LIKE #{tagLike}</if>
            </where>
            ORDER BY
              <choose>
                <when test="sort == 'name'">name COLLATE NOCASE ASC, id ASC</when>
                <when test="sort == 'size'">size_bytes DESC, id ASC</when>
                <when test="sort == 'created'">created_at DESC, id ASC</when>
                <otherwise>COALESCE(last_used_at, created_at) DESC, id ASC</otherwise>
              </choose>
            LIMIT #{limit} OFFSET #{offset}
            </script>
            """)
    List<AssetRow> search(@Param("mediaType") String mediaType,
            @Param("sourceType") String sourceType,
            @Param("reviewStatus") String reviewStatus,
            @Param("availability") String availability,
            @Param("licenseStatus") String licenseStatus,
            @Param("processingStatus") String processingStatus,
            @Param("folderId") String folderId,
            @Param("rootOnly") boolean rootOnly,
            @Param("q") String q,
            @Param("qLike") String qLike,
            @Param("tag") String tag,
            @Param("tagLike") String tagLike,
            @Param("sort") String sort,
            @Param("limit") int limit,
            @Param("offset") int offset);

    /** 与 {@link #search} 同条件的总数，供分页的 hasMore 判断。 */
    @Select("""
            <script>
            SELECT COUNT(*) FROM assets
            <where>
              <if test="mediaType != null">AND media_type = #{mediaType}</if>
              <if test="sourceType != null">AND source_type = #{sourceType}</if>
              <if test="reviewStatus != null">AND review_status = #{reviewStatus}</if>
              <if test="availability != null">AND availability = #{availability}</if>
              <if test="licenseStatus != null">AND license_status = #{licenseStatus}</if>
              <if test="processingStatus != null">AND processing_status = #{processingStatus}</if>
              <if test="folderId != null">AND folder_id = #{folderId}</if>
              <if test="rootOnly">AND folder_id IS NULL</if>
              <if test="q != null">AND (name LIKE #{qLike} OR tags_json LIKE #{qLike})</if>
              <if test="tag != null">AND tags_json LIKE #{tagLike}</if>
            </where>
            </script>
            """)
    int count(@Param("mediaType") String mediaType,
            @Param("sourceType") String sourceType,
            @Param("reviewStatus") String reviewStatus,
            @Param("availability") String availability,
            @Param("licenseStatus") String licenseStatus,
            @Param("processingStatus") String processingStatus,
            @Param("folderId") String folderId,
            @Param("rootOnly") boolean rootOnly,
            @Param("q") String q,
            @Param("qLike") String qLike,
            @Param("tag") String tag,
            @Param("tagLike") String tagLike);

    /**
     * 筛选面计数：不受当前筛选影响的全量计数（契约 library.md §2.2 对 facets 的口径）。
     */
    @Select("SELECT media_type AS k, COUNT(*) AS c FROM assets GROUP BY media_type")
    List<java.util.Map<String, Object>> countByMediaType();

    @Select("SELECT source_type AS k, COUNT(*) AS c FROM assets GROUP BY source_type")
    List<java.util.Map<String, Object>> countBySourceType();

    @Select("SELECT review_status AS k, COUNT(*) AS c FROM assets GROUP BY review_status")
    List<java.util.Map<String, Object>> countByReviewStatus();

    @Select("SELECT availability AS k, COUNT(*) AS c FROM assets GROUP BY availability")
    List<java.util.Map<String, Object>> countByAvailability();

    @Select("SELECT license_status AS k, COUNT(*) AS c FROM assets GROUP BY license_status")
    List<java.util.Map<String, Object>> countByLicenseStatus();

    @Select("SELECT COUNT(*) FROM assets")
    int countAll();
}
