package com.fengmotion.server.project.store.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * projects 表的基础读写。
 *
 * <p>映射使用显式的列别名（例如 {@code genome_id AS genomeId}），不依赖全局的
 * 下划线转驼峰配置。时间的写入由仓储层转换为 ISO-8601 字符串，保持 SQLite 中
 * {@code TEXT} 列的既有格式。</p>
 */
@Mapper
public interface ProjectMapper {

    /**
     * 插入新项目。
     *
     * @param row 待保存的行；{@code createdAt} 与 {@code updatedAt} 使用 ISO-8601 文本
     */
    @Insert("""
            INSERT INTO projects
                (id, name, genome_id, target_duration_ms, root_path, created_at, updated_at, etag)
            VALUES
                (#{id}, #{name}, #{genomeId}, #{targetDurationMs}, #{rootPath}, #{createdAt}, #{updatedAt}, #{etag})
            """)
    void insert(ProjectRow row);

    /**
     * 按 ID 查询项目，不按归档状态过滤（保持既有语义）。
     *
     * <p>投影保持迁移前的六列；{@code ProjectRow} 中未选择的字段为 null。
     * 完整字段请使用 {@link ProjectDataMapper#findActiveById(String)}。</p>
     *
     * @param id 项目 ID
     * @return 项目行；不存在时为 null
     */
    @Select("""
            SELECT id, name, genome_id AS genomeId, target_duration_ms AS targetDurationMs,
                   root_path AS rootPath, created_at AS createdAt
            FROM projects
            WHERE id = #{id}
            """)
    ProjectRow findById(@Param("id") String id);

    /**
     * 列出所有未归档项目的 ID 与目录。
     *
     * <p>只取升级项目指引需要的两列：启动期逐个检查目录，
     * 不需要把整个项目对象读出来。</p>
     *
     * @return 项目 ID 与根目录
     */
    @Select("""
            SELECT id, root_path AS rootPath
            FROM projects
            WHERE archived = 0 AND root_path IS NOT NULL AND root_path <> ''
            """)
    java.util.List<ProjectRow> findActiveRoots();
}
