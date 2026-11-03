package com.fengmotion.server.project.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * projects 表的活动项目查询与条件更新。
 *
 * <p>排序只有本接口中的三个固定方法，{@code ORDER BY} 是写死的 SQL 文本，
 * 调用方无法通过参数改变排序字段，因此不存在把用户输入拼进 ORDER BY 的入口。
 * 调用方按 {@code ProjectDataRepository.Sort} 枚举选择其中一个方法。</p>
 */
@Mapper
public interface ProjectDataMapper {

    /** 查询列；使用别名保证字段映射与列名规则解耦。 */
    String COLUMNS = """
            id, name, tagline, stage,
            genome_id AS genomeId, target_duration_ms AS targetDurationMs,
            root_path AS rootPath, created_at AS createdAt, updated_at AS updatedAt, etag
            """;

    /**
     * 活动项目的筛选条件。
     *
     * <p>{@code stage} 为 null 时不按阶段筛选；关键词在名称或简介中不区分大小写地
     * 查找，空字符串匹配所有项目（与迁移前保持一致）。</p>
     */
    String ACTIVE_FILTER = """
            FROM projects
            WHERE archived = 0
            <if test="stage != null">AND stage = #{stage}</if>
            AND (instr(lower(name), lower(#{keyword})) > 0 OR instr(lower(tagline), lower(#{keyword})) > 0)
            """;

    /**
     * 按 ID 查询未归档项目。
     *
     * @param id 项目 ID
     * @return 项目行；不存在或已归档时为 null
     */
    @Select("SELECT " + COLUMNS + " FROM projects WHERE id = #{id} AND archived = 0")
    ProjectRow findActiveById(@Param("id") String id);

    /**
     * 按更新时间降序、ID 升序查询。
     *
     * @param stage 项目阶段；为 null 时不筛选
     * @param keyword 名称或简介中的搜索词；空字符串匹配所有项目
     * @param limit 最多返回的行数
     * @param offset 跳过的行数
     * @return 活动项目行
     * <p>按 {@code julianday(updated_at)} 排序而不是直接比较 TEXT：SQLite 中
     * {@code Instant.toString()} 的毫秒位数不固定，字符串序会把
     * {@code 10:00:00.500Z} 排在 {@code 10:00:00Z} 之后。{@code julianday}
     * 精确到毫秒，同一毫秒内按 id 升序稳定排序。</p>
     */
    @Select("<script>SELECT " + COLUMNS + ACTIVE_FILTER
            + " ORDER BY julianday(updated_at) DESC, id ASC LIMIT #{limit} OFFSET #{offset}</script>")
    List<ProjectRow> findActiveByUpdatedDesc(@Param("stage") String stage, @Param("keyword") String keyword,
            @Param("limit") int limit, @Param("offset") int offset);

    /**
     * 按更新时间升序、ID 升序查询。
     *
     * @param stage 项目阶段；为 null 时不筛选
     * @param keyword 名称或简介中的搜索词；空字符串匹配所有项目
     * @param limit 最多返回的行数
     * @param offset 跳过的行数
     * @return 活动项目行
     */
    @Select("<script>SELECT " + COLUMNS + ACTIVE_FILTER
            + " ORDER BY julianday(updated_at) ASC, id ASC LIMIT #{limit} OFFSET #{offset}</script>")
    List<ProjectRow> findActiveByUpdatedAsc(@Param("stage") String stage, @Param("keyword") String keyword,
            @Param("limit") int limit, @Param("offset") int offset);

    /**
     * 按名称升序、ID 升序查询。
     *
     * @param stage 项目阶段；为 null 时不筛选
     * @param keyword 名称或简介中的搜索词；空字符串匹配所有项目
     * @param limit 最多返回的行数
     * @param offset 跳过的行数
     * @return 活动项目行
     */
    @Select("<script>SELECT " + COLUMNS + ACTIVE_FILTER
            + " ORDER BY name ASC, id ASC LIMIT #{limit} OFFSET #{offset}</script>")
    List<ProjectRow> findActiveByNameAsc(@Param("stage") String stage, @Param("keyword") String keyword,
            @Param("limit") int limit, @Param("offset") int offset);

    /**
     * 仅在项目未归档且 etag 匹配时更新；返回受影响行数，0 表示没有匹配记录。
     *
     * <p>etag 条件写在 SQL 中，避免查询之后、更新之前发生的并发修改被覆盖。
     * 时间以 ISO-8601 字符串写入，保持 TEXT 列格式；{@code targetDurationMs} 为 null
     * 时写入 SQL NULL。</p>
     *
     * @param update 更新参数
     * @return 实际更新的行数
     */
    @Update("""
            UPDATE projects
            SET name = #{name},
                tagline = #{tagline},
                stage = #{stage},
                genome_id = #{genomeId},
                target_duration_ms = #{targetDurationMs},
                updated_at = #{updatedAt},
                etag = #{nextEtag}
            WHERE id = #{id} AND etag = #{matchEtag} AND archived = 0
            """)
    int updateIfMatch(ProjectUpdateParams update);

    /**
     * 归档未归档的项目；重复归档不改变已有归档时间。
     *
     * <p>归档不是删除：项目行与目录都保留，只是不再出现在查询结果中。
     * 契约 project.md §3.5 的删除默认走这里，{@code purge=true} 的物理删除尚未接入。</p>
     *
     * @param id         项目 ID
     * @param archivedAt ISO-8601 格式的归档时间
     * @return 受影响行数；0 表示项目不存在或已归档
     */
    @Update("""
            UPDATE projects
            SET archived = 1, archived_at = #{archivedAt}
            WHERE id = #{id} AND archived = 0
            """)
    int archiveIfActive(@Param("id") String id, @Param("archivedAt") String archivedAt);

    /**
     * 条件更新的参数。
     *
     * @param id 项目 ID
     * @param matchEtag 调用方持有的原版本标识
     * @param name 名称
     * @param tagline 简介
     * @param stage 阶段
     * @param genomeId 视频类型 ID
     * @param targetDurationMs 目标时长；可为 null
     * @param updatedAt ISO-8601 格式的更新时间
     * @param nextEtag 更新成功后的新版本标识
     */
    record ProjectUpdateParams(String id, String matchEtag, String name, String tagline, String stage,
            String genomeId, Long targetDurationMs, String updatedAt, String nextEtag) {
    }
}
