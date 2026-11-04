package com.fengmotion.server.fx.store.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * fx_user_state 表读写：收藏与最近浏览。
 *
 * <p>与技法目录**分开存**：技法目录是可重建的来源数据，用户状态是不可重建的个人记录。
 * 放在同一张表里，一次目录重建就会把用户收藏冲掉。</p>
 */
@Mapper
public interface FxUserStateMapper {

    /** 用户状态行。 */
    @Data
    @NoArgsConstructor
    class UserStateRow {
        private String techniqueId;
        private Integer favorited;
        private String lastViewedAt;
        private String updatedAt;
    }

    @Insert("""
            INSERT INTO fx_user_state (technique_id, favorited, last_viewed_at, updated_at)
            VALUES (#{techniqueId}, #{favorited}, #{lastViewedAt}, #{updatedAt})
            ON CONFLICT(technique_id) DO UPDATE SET
                favorited = excluded.favorited,
                last_viewed_at = COALESCE(excluded.last_viewed_at, fx_user_state.last_viewed_at),
                updated_at = excluded.updated_at
            """)
    void upsert(UserStateRow row);

    /** 只更新收藏，不动最近浏览时间。 */
    @Insert("""
            INSERT INTO fx_user_state (technique_id, favorited, updated_at)
            VALUES (#{techniqueId}, #{favorited}, #{updatedAt})
            ON CONFLICT(technique_id) DO UPDATE SET
                favorited = excluded.favorited,
                updated_at = excluded.updated_at
            """)
    void upsertFavorite(@Param("techniqueId") String techniqueId,
            @Param("favorited") int favorited,
            @Param("updatedAt") String updatedAt);

    /** 只更新最近浏览时间，不动收藏。 */
    @Insert("""
            INSERT INTO fx_user_state (technique_id, favorited, last_viewed_at, updated_at)
            VALUES (#{techniqueId}, 0, #{viewedAt}, #{viewedAt})
            ON CONFLICT(technique_id) DO UPDATE SET
                last_viewed_at = excluded.last_viewed_at,
                updated_at = excluded.updated_at
            """)
    void touchViewed(@Param("techniqueId") String techniqueId, @Param("viewedAt") String viewedAt);

    @Select("SELECT * FROM fx_user_state WHERE technique_id = #{techniqueId}")
    UserStateRow findByTechnique(@Param("techniqueId") String techniqueId);

    @Select("SELECT technique_id FROM fx_user_state WHERE favorited = 1 ORDER BY updated_at DESC")
    java.util.List<String> listFavorited();
}
