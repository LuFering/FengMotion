package com.fengmotion.server.reference.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * reference_videos 表读写。
 *
 * <p>{@code q} 匹配标题、描述与标签 —— 用户搜「咖啡店」时，那更多出现在标题或标签里。</p>
 */
@Mapper
public interface ReferenceVideoMapper {

    @Insert("""
            INSERT INTO reference_videos
                (id, title, duration_ms, source, description, tags_json, asset_id, thumbnail_url,
                 status, created_at, updated_at, demo)
            VALUES
                (#{id}, #{title}, #{durationMs}, #{source}, #{description}, #{tagsJson}, #{assetId},
                 #{thumbnailUrl}, #{status}, #{createdAt}, #{updatedAt}, #{demo})
            """)
    void insert(ReferenceVideoRow row);

    @Update("""
            UPDATE reference_videos SET
                title = #{title}, duration_ms = #{durationMs}, source = #{source},
                description = #{description}, tags_json = #{tagsJson}, asset_id = #{assetId},
                thumbnail_url = #{thumbnailUrl}, status = #{status}, updated_at = #{updatedAt}
            WHERE id = #{id}
            """)
    int update(ReferenceVideoRow row);

    /** 只更新解析状态（解析任务完成后回写）。 */
    @Update("UPDATE reference_videos SET status = #{status}, updated_at = #{updatedAt} WHERE id = #{id}")
    int updateStatus(@Param("id") String id, @Param("status") String status,
            @Param("updatedAt") String updatedAt);

    @Select("SELECT * FROM reference_videos WHERE id = #{id}")
    ReferenceVideoRow findById(@Param("id") String id);

    @Select("SELECT * FROM reference_videos WHERE asset_id = #{assetId} LIMIT 1")
    ReferenceVideoRow findByAsset(@Param("assetId") String assetId);

    @Delete("DELETE FROM reference_videos WHERE id = #{id}")
    int deleteById(@Param("id") String id);

    @Select("""
            <script>
            SELECT * FROM reference_videos
            <where>
              <if test="status != null">AND status = #{status}</if>
              <if test="tag != null">AND tags_json LIKE #{tagLike}</if>
              <if test="q != null">AND (title LIKE #{qLike} OR description LIKE #{qLike}
                   OR tags_json LIKE #{qLike})</if>
            </where>
            ORDER BY created_at DESC, id ASC
            LIMIT #{limit} OFFSET #{offset}
            </script>
            """)
    List<ReferenceVideoRow> search(@Param("status") String status,
            @Param("tag") String tag,
            @Param("tagLike") String tagLike,
            @Param("q") String q,
            @Param("qLike") String qLike,
            @Param("limit") int limit,
            @Param("offset") int offset);

    @Select("""
            <script>
            SELECT COUNT(*) FROM reference_videos
            <where>
              <if test="status != null">AND status = #{status}</if>
              <if test="tag != null">AND tags_json LIKE #{tagLike}</if>
              <if test="q != null">AND (title LIKE #{qLike} OR description LIKE #{qLike}
                   OR tags_json LIKE #{qLike})</if>
            </where>
            </script>
            """)
    int count(@Param("status") String status,
            @Param("tag") String tag,
            @Param("tagLike") String tagLike,
            @Param("q") String q,
            @Param("qLike") String qLike);

    @Select("SELECT COUNT(*) FROM reference_videos")
    int countAll();
}
