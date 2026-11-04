package com.fengmotion.server.reference.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 工作区级个人偏好：收藏与最近浏览。
 *
 * <p>收藏只是个人标记，**不代表「已审核 / 已采用」**（契约 §5）。
 * 与素材、特效的偏好分开存，三库不混用。</p>
 */
@Mapper
public interface ReferencePreferenceMapper {

    String KIND_FAVORITE = "favorite";
    String KIND_RECENT = "recent";

    @Insert("INSERT OR REPLACE INTO reference_preferences (kind, segment_id, marked_at) "
            + "VALUES (#{kind}, #{segmentId}, #{markedAt})")
    void mark(@Param("kind") String kind, @Param("segmentId") String segmentId,
            @Param("markedAt") String markedAt);

    @Delete("DELETE FROM reference_preferences WHERE kind = #{kind} AND segment_id = #{segmentId}")
    int unmark(@Param("kind") String kind, @Param("segmentId") String segmentId);

    @Select("SELECT segment_id FROM reference_preferences WHERE kind = #{kind} "
            + "ORDER BY marked_at DESC")
    List<String> list(@Param("kind") String kind);

    @Select("SELECT segment_id FROM reference_preferences WHERE kind = #{kind} "
            + "ORDER BY marked_at DESC LIMIT #{limit}")
    List<String> listLimited(@Param("kind") String kind, @Param("limit") int limit);

    /** 清理「最近浏览」中超出上限的旧记录，避免无限增长。 */
    @Delete("DELETE FROM reference_preferences WHERE kind = #{kind} AND segment_id NOT IN "
            + "(SELECT segment_id FROM reference_preferences WHERE kind = #{kind} "
            + "ORDER BY marked_at DESC LIMIT #{keep})")
    int trim(@Param("kind") String kind, @Param("keep") int keep);
}
