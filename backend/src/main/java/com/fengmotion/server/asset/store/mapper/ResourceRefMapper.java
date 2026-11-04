package com.fengmotion.server.asset.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * resource_refs 表读写：资源被谁引用了。
 *
 * <p>删除素材前必须查这张表。前端缓存里的引用信息不可信 —— 项目被删、任务被清理之后，
 * 缓存还留在浏览器里，只有库里的引用关系是准的。</p>
 */
@Mapper
public interface ResourceRefMapper {

    /** 一条引用关系。 */
    @Data
    @NoArgsConstructor
    class RefRow {
        private String resourceKind;
        private String resourceId;
        private String refKind;
        private String refId;
        private String refLabel;
        private String createdAt;
    }

    @Insert("""
            INSERT OR IGNORE INTO resource_refs
                (resource_kind, resource_id, ref_kind, ref_id, ref_label, created_at)
            VALUES
                (#{resourceKind}, #{resourceId}, #{refKind}, #{refId}, #{refLabel}, #{createdAt})
            """)
    void insert(RefRow row);

    @Select("""
            SELECT resource_kind, resource_id, ref_kind, ref_id, ref_label, created_at
            FROM resource_refs
            WHERE resource_kind = #{resourceKind} AND resource_id = #{resourceId}
            ORDER BY ref_kind, ref_id
            """)
    List<RefRow> findByResource(@Param("resourceKind") String resourceKind,
            @Param("resourceId") String resourceId);

    @Select("""
            SELECT COUNT(*) FROM resource_refs
            WHERE resource_kind = #{resourceKind} AND resource_id = #{resourceId}
            """)
    int countByResource(@Param("resourceKind") String resourceKind,
            @Param("resourceId") String resourceId);

    @Delete("""
            DELETE FROM resource_refs
            WHERE resource_kind = #{resourceKind} AND resource_id = #{resourceId}
            """)
    int deleteByResource(@Param("resourceKind") String resourceKind,
            @Param("resourceId") String resourceId);
}
