package com.fengmotion.server.reference.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * reference_segments 表读写。
 *
 * <p>{@code q} 匹配观察、推断、建议与标签。**匹配推断文本不等于它是事实** ——
 * 这里只负责检索，呈现时仍按字段区分来源。</p>
 */
@Mapper
public interface ReferenceSegmentMapper {

    @Insert("""
            INSERT INTO reference_segments
                (id, video_id, idx, start_ms, end_ms, status, tags_json, observation, inference,
                 suggestion, analysis_json, extra_analysis_json, created_at, updated_at)
            VALUES
                (#{id}, #{videoId}, #{idx}, #{startMs}, #{endMs}, #{status}, #{tagsJson}, #{observation},
                 #{inference}, #{suggestion}, #{analysisJson}, #{extraAnalysisJson}, #{createdAt},
                 #{updatedAt})
            """)
    void insert(ReferenceSegmentRow row);

    @Update("""
            UPDATE reference_segments SET
                idx = #{idx}, start_ms = #{startMs}, end_ms = #{endMs}, status = #{status},
                tags_json = #{tagsJson}, observation = #{observation}, inference = #{inference},
                suggestion = #{suggestion}, analysis_json = #{analysisJson},
                extra_analysis_json = #{extraAnalysisJson}, updated_at = #{updatedAt}
            WHERE id = #{id}
            """)
    int update(ReferenceSegmentRow row);

    @Select("SELECT * FROM reference_segments WHERE id = #{id}")
    ReferenceSegmentRow findById(@Param("id") String id);

    @Delete("DELETE FROM reference_segments WHERE id = #{id}")
    int deleteById(@Param("id") String id);

    @Select("SELECT * FROM reference_segments WHERE video_id = #{videoId} ORDER BY idx ASC")
    List<ReferenceSegmentRow> findByVideo(@Param("videoId") String videoId);

    @Select("SELECT COUNT(*) FROM reference_segments WHERE video_id = #{videoId}")
    int countByVideo(@Param("videoId") String videoId);

    /** 该视频下一个可用的序号：切片时用来避免 UNIQUE(video_id, idx) 冲突。 */
    @Select("SELECT COALESCE(MAX(idx), -1) + 1 FROM reference_segments WHERE video_id = #{videoId}")
    int nextIndex(@Param("videoId") String videoId);

    @Select("""
            <script>
            SELECT * FROM reference_segments
            <where>
              <if test="videoId != null">AND video_id = #{videoId}</if>
              <if test="status != null">AND status = #{status}</if>
              <if test="tag != null">AND tags_json LIKE #{tagLike}</if>
              <if test="q != null">AND (observation LIKE #{qLike} OR inference LIKE #{qLike}
                   OR suggestion LIKE #{qLike} OR tags_json LIKE #{qLike})</if>
            </where>
            ORDER BY video_id ASC, idx ASC
            LIMIT #{limit} OFFSET #{offset}
            </script>
            """)
    List<ReferenceSegmentRow> search(@Param("videoId") String videoId,
            @Param("status") String status,
            @Param("tag") String tag,
            @Param("tagLike") String tagLike,
            @Param("q") String q,
            @Param("qLike") String qLike,
            @Param("limit") int limit,
            @Param("offset") int offset);

    @Select("""
            <script>
            SELECT COUNT(*) FROM reference_segments
            <where>
              <if test="videoId != null">AND video_id = #{videoId}</if>
              <if test="status != null">AND status = #{status}</if>
              <if test="tag != null">AND tags_json LIKE #{tagLike}</if>
              <if test="q != null">AND (observation LIKE #{qLike} OR inference LIKE #{qLike}
                   OR suggestion LIKE #{qLike} OR tags_json LIKE #{qLike})</if>
            </where>
            </script>
            """)
    int count(@Param("videoId") String videoId,
            @Param("status") String status,
            @Param("tag") String tag,
            @Param("tagLike") String tagLike,
            @Param("q") String q,
            @Param("qLike") String qLike);
}
