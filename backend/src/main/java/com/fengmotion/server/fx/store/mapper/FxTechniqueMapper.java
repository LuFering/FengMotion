package com.fengmotion.server.fx.store.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * fx_techniques 表读写。
 *
 * <p>检索口径与素材库一致（对账 §4.1）：结构化筛选 + 中文子串匹配，
 * **不上 FTS5**。技法只有十几到几十条，`LIKE` 的语义确定且够快；
 * 引入全文索引要额外处理中文分词，收益为零。</p>
 *
 * <p>{@code q} 同时匹配名称、英文名、别名、检索词与用途 ——
 * 用户搜「眩晕」时，技法表里它出现在 keywords 与 aliases 中，只搜 name 会搜不到。</p>
 */
@Mapper
public interface FxTechniqueMapper {

    @Insert("""
            INSERT OR REPLACE INTO fx_techniques
                (id, name, name_en, aliases_json, keywords_json, intent, category, category_label,
                 scenes_json, anti_scenes_json, exec_type, exec_label, execution_status, impl, impl_label,
                 complexity, input_kinds_json, input_labels_json, input_requirement, output,
                 dependencies_json, steps_json, compatibility_json, limitations_json, failures_json,
                 params_json, preview_image_url, preview_video_url, preview_caption,
                 related_json, alternatives_json, featured, version, updated_at, demo,
                 source_kind, source_project, source_url, source_version,
                 license_code, license_preview, attribution, source_path, imported_at)
            VALUES
                (#{id}, #{name}, #{nameEn}, #{aliasesJson}, #{keywordsJson}, #{intent}, #{category},
                 #{categoryLabel}, #{scenesJson}, #{antiScenesJson}, #{execType}, #{execLabel},
                 #{executionStatus}, #{impl}, #{implLabel}, #{complexity}, #{inputKindsJson},
                 #{inputLabelsJson}, #{inputRequirement}, #{output}, #{dependenciesJson}, #{stepsJson},
                 #{compatibilityJson}, #{limitationsJson}, #{failuresJson}, #{paramsJson},
                 #{previewImageUrl}, #{previewVideoUrl}, #{previewCaption}, #{relatedJson},
                 #{alternativesJson}, #{featured}, #{version}, #{updatedAt}, #{demo},
                 #{sourceKind}, #{sourceProject}, #{sourceUrl}, #{sourceVersion},
                 #{licenseCode}, #{licensePreview}, #{attribution}, #{sourcePath}, #{importedAt})
            """)
    void upsert(FxTechniqueRow row);

    @Select("SELECT * FROM fx_techniques WHERE id = #{id}")
    FxTechniqueRow findById(@Param("id") String id);

    @Select("SELECT COUNT(*) FROM fx_techniques")
    int countAll();

    /**
     * 列表查询：结构化筛选 + 中文子串 + 排序。
     *
     * <p>排序用 {@code LIMIT/OFFSET}，游标是偏移量（与素材列表一致）。</p>
     */
    @Select("""
            <script>
            SELECT * FROM fx_techniques
            <where>
              <if test="category != null">AND category = #{category}</if>
              <if test="execType != null">AND exec_type = #{execType}</if>
              <if test="impl != null">AND impl = #{impl}</if>
              <if test="inputKind != null">AND input_kinds_json LIKE #{inputKindLike}</if>
              <if test="maxComplexity != null">AND complexity &lt;= #{maxComplexity}</if>
              <if test="featured">AND featured = 1</if>
              <if test="onlyFavorited">AND EXISTS (SELECT 1 FROM fx_user_state s
                   WHERE s.technique_id = fx_techniques.id AND s.favorited = 1)</if>
              <if test="q != null">AND (
                   name LIKE #{qLike} OR name_en LIKE #{qLike} OR intent LIKE #{qLike}
                   OR aliases_json LIKE #{qLike} OR keywords_json LIKE #{qLike})</if>
            </where>
            ORDER BY
              <choose>
                <when test="sort == 'complexity'">complexity ASC, name ASC</when>
                <when test="sort == 'updated'">updated_at DESC, name ASC</when>
                <otherwise>category ASC, name ASC</otherwise>
              </choose>
            LIMIT #{limit} OFFSET #{offset}
            </script>
            """)
    List<FxTechniqueRow> search(@Param("category") String category,
            @Param("execType") String execType,
            @Param("impl") String impl,
            @Param("inputKind") String inputKind,
            @Param("inputKindLike") String inputKindLike,
            @Param("maxComplexity") Integer maxComplexity,
            @Param("featured") boolean featured,
            @Param("onlyFavorited") boolean onlyFavorited,
            @Param("q") String q,
            @Param("qLike") String qLike,
            @Param("sort") String sort,
            @Param("limit") int limit,
            @Param("offset") int offset);

    /** 与 {@link #search} 同条件的总数。 */
    @Select("""
            <script>
            SELECT COUNT(*) FROM fx_techniques
            <where>
              <if test="category != null">AND category = #{category}</if>
              <if test="execType != null">AND exec_type = #{execType}</if>
              <if test="impl != null">AND impl = #{impl}</if>
              <if test="inputKind != null">AND input_kinds_json LIKE #{inputKindLike}</if>
              <if test="maxComplexity != null">AND complexity &lt;= #{maxComplexity}</if>
              <if test="featured">AND featured = 1</if>
              <if test="onlyFavorited">AND EXISTS (SELECT 1 FROM fx_user_state s
                   WHERE s.technique_id = fx_techniques.id AND s.favorited = 1)</if>
              <if test="q != null">AND (
                   name LIKE #{qLike} OR name_en LIKE #{qLike} OR intent LIKE #{qLike}
                   OR aliases_json LIKE #{qLike} OR keywords_json LIKE #{qLike})</if>
            </where>
            </script>
            """)
    int count(@Param("category") String category,
            @Param("execType") String execType,
            @Param("impl") String impl,
            @Param("inputKind") String inputKind,
            @Param("inputKindLike") String inputKindLike,
            @Param("maxComplexity") Integer maxComplexity,
            @Param("featured") boolean featured,
            @Param("onlyFavorited") boolean onlyFavorited,
            @Param("q") String q,
            @Param("qLike") String qLike);

    // ── 筛选面计数（不受当前筛选影响的全量口径）──

    @Select("SELECT category AS k, COUNT(*) AS c FROM fx_techniques GROUP BY category")
    List<java.util.Map<String, Object>> countByCategory();

    @Select("SELECT exec_type AS k, COUNT(*) AS c FROM fx_techniques GROUP BY exec_type")
    List<java.util.Map<String, Object>> countByExecType();

    @Select("SELECT impl AS k, COUNT(*) AS c FROM fx_techniques GROUP BY impl")
    List<java.util.Map<String, Object>> countByImpl();

    @Select("SELECT complexity AS k, COUNT(*) AS c FROM fx_techniques GROUP BY complexity")
    List<java.util.Map<String, Object>> countByComplexity();
}
