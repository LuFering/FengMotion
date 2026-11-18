package com.fengmotion.server.preset.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/** workflow_presets 表的 MyBatis 映射。 */
@Mapper
public interface WorkflowPresetMapper {

    String COLUMNS = """
            id AS id, name AS name, description AS description, status AS status,
            skill_package_id AS skillPackageId, source_repo AS sourceRepo, skill_path AS skillPath,
            commit_sha AS commitSha, mapping_json AS mappingJson, mapping_version AS mappingVersion,
            created_at AS createdAt, updated_at AS updatedAt, activated_at AS activatedAt
            """;

    @Insert("""
            INSERT INTO workflow_presets
                (id, name, description, status, skill_package_id, source_repo, skill_path, commit_sha,
                 mapping_json, mapping_version, created_at, updated_at, activated_at)
            VALUES
                (#{id}, #{name}, #{description}, #{status}, #{skillPackageId}, #{sourceRepo}, #{skillPath}, #{commitSha},
                 #{mappingJson}, #{mappingVersion}, #{createdAt}, #{updatedAt}, #{activatedAt})
            """)
    int insert(WorkflowPresetRow row);

    @Select("SELECT " + COLUMNS + " FROM workflow_presets WHERE id = #{id}")
    WorkflowPresetRow findById(@Param("id") String id);

    @Select("SELECT " + COLUMNS + " FROM workflow_presets WHERE status = #{status} ORDER BY julianday(updated_at) DESC, id")
    List<WorkflowPresetRow> findByStatus(@Param("status") String status);

    @Select("SELECT " + COLUMNS + " FROM workflow_presets ORDER BY julianday(updated_at) DESC, id")
    List<WorkflowPresetRow> findAll();

    /** 只在状态仍为 expected 时更新，防止并发下改到已启用的预设。 */
    @Update("""
            UPDATE workflow_presets
               SET name = #{name}, description = #{description}, mapping_json = #{mappingJson},
                   mapping_version = #{mappingVersion}, updated_at = #{updatedAt}
             WHERE id = #{id} AND status = #{expected}
            """)
    int updateMapping(@Param("id") String id, @Param("expected") String expected, @Param("name") String name,
                      @Param("description") String description, @Param("mappingJson") String mappingJson,
                      @Param("mappingVersion") int mappingVersion, @Param("updatedAt") String updatedAt);

    @Update("""
            UPDATE workflow_presets
               SET status = #{status}, updated_at = #{updatedAt},
                   activated_at = COALESCE(#{activatedAt}, activated_at)
             WHERE id = #{id} AND status = #{expected}
            """)
    int updateStatus(@Param("id") String id, @Param("expected") String expected, @Param("status") String status,
                     @Param("updatedAt") String updatedAt, @Param("activatedAt") String activatedAt);
}
