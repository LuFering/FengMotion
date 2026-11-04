package com.fengmotion.server.fx.store;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.fengmotion.server.fx.domain.FxStates;
import com.fengmotion.server.fx.domain.FxTechnique;

/**
 * 特效技法持久化边界。
 *
 * <p>服务层只依赖本接口：这样「execType 只是标签、executionStatus 才是能不能跑」
 * 这类规则集中在服务层，换存储实现不会牵动业务判断。</p>
 */
public interface FxTechniqueRepository {

    void upsert(FxTechnique technique);

    Optional<FxTechnique> findById(String id);

    int countAll();

    List<FxTechnique> search(FxQuery query);

    int count(FxQuery query);

    /** 全量筛选面（不受当前筛选影响）。 */
    Map<String, Map<String, Integer>> facets();

    // ── 用户状态 ──

    /** 用户收藏与最近浏览。 */
    record UserState(boolean favorited, java.time.Instant lastViewedAt) {
    }

    Optional<UserState> userState(String techniqueId);

    void setFavorite(String techniqueId, boolean favorited);

    void touchViewed(String techniqueId);

    List<String> listFavorited();

    /**
     * 列表查询条件。
     *
     * @param category      分类
     * @param execType      源库声明的执行类型
     * @param impl          实现方式
     * @param inputKind     输入类型（JSON 数组内包含）
     * @param maxComplexity 复杂度上限
     * @param featured      只看精选
     * @param onlyFavorited 只看收藏
     * @param q             名称/英文名/用途/别名/检索词子串
     * @param sort          cat / complexity / updated
     * @param limit         每页数量
     * @param offset        偏移量
     */
    record FxQuery(
            FxStates.Category category,
            FxStates.ExecType execType,
            FxStates.Impl impl,
            FxStates.InputKind inputKind,
            Integer maxComplexity,
            boolean featured,
            boolean onlyFavorited,
            String q,
            String sort,
            int limit,
            int offset) {

        /** LIKE 模式串；转义用户输入里的 % 与 _，避免被当通配符。 */
        public String qLike() {
            return likePattern(q);
        }

        public String inputKindLike() {
            return inputKind == null ? null : likePattern("\"" + inputKind.wire() + "\"");
        }

        private static String likePattern(String raw) {
            if (raw == null) {
                return null;
            }
            String escaped = raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
            return "%" + escaped + "%";
        }
    }
}
