package com.fengmotion.server.fx.service;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.fx.domain.FxStates;
import com.fengmotion.server.fx.domain.FxTechnique;
import com.fengmotion.server.fx.store.FxTechniqueRepository;
import com.fengmotion.server.fx.store.FxTechniqueRepository.FxQuery;
import com.fengmotion.server.fx.store.FxTechniqueRepository.UserState;

/**
 * 特效库查询与用户状态。
 *
 * <p>「选中技法」与「技法能执行」是两件事：本接口只负责把技法知识（含限制、依赖、
 * 本机执行状态）交给调用方。<strong>在真实执行链可用之前，不宣称「已用于生成」</strong>
 * （契约 library.md §2.2）。</p>
 */
@Service
public class FxTechniqueService {

    private final FxTechniqueRepository repository;

    public FxTechniqueService(FxTechniqueRepository repository) {
        this.repository = repository;
    }

    /**
     * 列表查询。
     *
     * @return 技法列表（每条的 {@code userState} 由调用方按需附加）
     */
    public List<FxTechnique> search(FxQuery query) {
        return repository.search(query);
    }

    public int count(FxQuery query) {
        return repository.count(query);
    }

    public int total() {
        return repository.countAll();
    }

    public FxTechnique require(String id) {
        return repository.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "技法不存在"));
    }

    public java.util.Map<String, java.util.Map<String, Integer>> facets() {
        return repository.facets();
    }

    public UserState userState(String id) {
        return repository.userState(id).orElse(new UserState(false, null));
    }

    public List<String> favorited() {
        return repository.listFavorited();
    }

    /**
     * 更新用户状态（收藏 / 最近浏览）。
     *
     * <p>两者互相独立：收藏一条技法不该顺手改它的「最近浏览」，反之亦然 ——
     * 「我收藏过」和「我刚看过」回答的是不同问题。</p>
     *
     * @param id        技法 ID
     * @param favorited 收藏状态；null 表示不改
     * @param viewed    是否记为「刚浏览过」
     */
    @Transactional
    public UserState updateState(String id, Boolean favorited, boolean viewed) {
        require(id);
        if (favorited != null) {
            repository.setFavorite(id, favorited);
        }
        if (viewed) {
            repository.touchViewed(id);
        }
        return userState(id);
    }

    /**
     * 本机是否真的能执行这条技法。
     *
     * <p>唯一判据是 {@link FxStates.ExecutionStatus#AVAILABLE}。
     * <strong>不要用 {@code execType} 判断</strong> —— 那是源库的说法，不是本机事实。</p>
     */
    public boolean executableNow(String id) {
        return require(id).executionStatus().executableNow();
    }
}
