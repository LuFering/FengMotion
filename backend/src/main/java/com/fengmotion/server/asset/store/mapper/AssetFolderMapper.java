package com.fengmotion.server.asset.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * asset_folders 表读写。
 */
@Mapper
public interface AssetFolderMapper {

    @Insert("""
            INSERT INTO asset_folders (id, name, created_at, updated_at)
            VALUES (#{id}, #{name}, #{createdAt}, #{updatedAt})
            """)
    void insert(AssetFolderRow row);

    @Select("SELECT * FROM asset_folders WHERE id = #{id}")
    AssetFolderRow findById(@Param("id") String id);

    @Select("SELECT * FROM asset_folders WHERE name = #{name} LIMIT 1")
    AssetFolderRow findByName(@Param("name") String name);

    @Select("SELECT * FROM asset_folders ORDER BY name COLLATE NOCASE ASC")
    List<AssetFolderRow> findAll();

    @Update("UPDATE asset_folders SET name = #{name}, updated_at = #{updatedAt} WHERE id = #{id}")
    int rename(@Param("id") String id, @Param("name") String name, @Param("updatedAt") String updatedAt);

    @Delete("DELETE FROM asset_folders WHERE id = #{id}")
    int deleteById(@Param("id") String id);
}
