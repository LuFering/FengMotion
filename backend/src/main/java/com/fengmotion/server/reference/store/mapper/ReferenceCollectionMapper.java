package com.fengmotion.server.reference.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 参考集合与成员关系。
 *
 * <p>成员关系单独成表：一个片段可以在多个集合里。删集合只删成员关系，
 * 不删片段本身（片段属于视频，不属于集合）。</p>
 */
@Mapper
public interface ReferenceCollectionMapper {

    /** 集合行。 */
    @Data
    @NoArgsConstructor
    class CollectionRow {
        private String id;
        private String name;
        private String note;
        private String createdAt;
        private String updatedAt;
    }

    @Insert("""
            INSERT INTO reference_collections (id, name, note, created_at, updated_at)
            VALUES (#{id}, #{name}, #{note}, #{createdAt}, #{updatedAt})
            """)
    void insert(CollectionRow row);

    @Update("UPDATE reference_collections SET name = #{name}, note = #{note}, updated_at = #{updatedAt} "
            + "WHERE id = #{id}")
    int update(CollectionRow row);

    @Select("SELECT * FROM reference_collections WHERE id = #{id}")
    CollectionRow findById(@Param("id") String id);

    @Select("SELECT * FROM reference_collections ORDER BY created_at ASC")
    List<CollectionRow> findAll();

    @Delete("DELETE FROM reference_collections WHERE id = #{id}")
    int deleteById(@Param("id") String id);

    // ── 成员关系 ──

    @Insert("INSERT OR IGNORE INTO reference_collection_members (collection_id, segment_id, added_at) "
            + "VALUES (#{collectionId}, #{segmentId}, #{addedAt})")
    void addMember(@Param("collectionId") String collectionId,
            @Param("segmentId") String segmentId,
            @Param("addedAt") String addedAt);

    @Delete("DELETE FROM reference_collection_members "
            + "WHERE collection_id = #{collectionId} AND segment_id = #{segmentId}")
    int removeMember(@Param("collectionId") String collectionId, @Param("segmentId") String segmentId);

    @Delete("DELETE FROM reference_collection_members WHERE collection_id = #{collectionId}")
    int clearMembers(@Param("collectionId") String collectionId);

    @Select("SELECT segment_id FROM reference_collection_members "
            + "WHERE collection_id = #{collectionId} ORDER BY added_at ASC")
    List<String> listMembers(@Param("collectionId") String collectionId);

    @Select("SELECT COUNT(*) FROM reference_collection_members WHERE collection_id = #{collectionId}")
    int countMembers(@Param("collectionId") String collectionId);
}
