package com.fengmotion.server.skill.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/** skill_packages 表的 MyBatis 映射。 */
@Mapper
public interface SkillPackageMapper {

    String COLUMNS = """
            id AS id, owner AS owner, repo AS repo, requested_ref AS requestedRef,
            commit_sha AS commitSha, sub_path AS subPath, root_dir AS rootDir,
            file_count AS fileCount, total_bytes AS totalBytes, report_json AS reportJson,
            imported_at AS importedAt
            """;

    @Insert("""
            INSERT INTO skill_packages
                (id, owner, repo, requested_ref, commit_sha, sub_path, root_dir,
                 file_count, total_bytes, report_json, imported_at)
            VALUES
                (#{id}, #{owner}, #{repo}, #{requestedRef}, #{commitSha}, #{subPath}, #{rootDir},
                 #{fileCount}, #{totalBytes}, #{reportJson}, #{importedAt})
            """)
    int insert(SkillPackageRow row);

    @Select("SELECT " + COLUMNS + " FROM skill_packages WHERE id = #{id}")
    SkillPackageRow findById(@Param("id") String id);

    @Select("SELECT " + COLUMNS + """
             FROM skill_packages
            WHERE owner = #{owner} AND repo = #{repo} AND commit_sha = #{commitSha} AND sub_path = #{subPath}
            """)
    SkillPackageRow findByIdentity(@Param("owner") String owner, @Param("repo") String repo,
                                   @Param("commitSha") String commitSha, @Param("subPath") String subPath);

    /** 列表不读报告正文：报告可能很大，列表只需要摘要字段。 */
    @Select("""
            SELECT id AS id, owner AS owner, repo AS repo, requested_ref AS requestedRef,
                   commit_sha AS commitSha, sub_path AS subPath, root_dir AS rootDir,
                   file_count AS fileCount, total_bytes AS totalBytes, NULL AS reportJson,
                   imported_at AS importedAt
              FROM skill_packages
             ORDER BY julianday(imported_at) DESC, id
            """)
    List<SkillPackageRow> findAll();

    @Delete("DELETE FROM skill_packages WHERE id = #{id}")
    int delete(@Param("id") String id);
}
