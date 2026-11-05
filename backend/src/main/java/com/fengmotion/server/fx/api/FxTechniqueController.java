package com.fengmotion.server.fx.api;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.common.Pagination;
import com.fengmotion.server.fx.api.dto.FxTechniqueResponse;
import com.fengmotion.server.fx.api.dto.FxTechniqueResponse.ParamResponse;
import com.fengmotion.server.fx.api.dto.FxTechniqueResponse.UserStateResponse;
import com.fengmotion.server.fx.domain.FxStates;
import com.fengmotion.server.fx.domain.FxTechnique;
import com.fengmotion.server.fx.service.FxTechniqueService;
import com.fengmotion.server.fx.store.FxTechniqueRepository.FxQuery;
import com.fengmotion.server.fx.store.FxTechniqueRepository.UserState;

/**
 * 特效库接口（契约 docs/contracts/library.md §2.2）。
 *
 * <p>技法目录**只读**：不提供新增/修改/删除技法本身。用户可改的只有收藏与最近浏览，
 * 走 {@code PATCH /fx-techniques/{id}/state}。</p>
 *
 * <p>「用于工作流」在真实调用链可用前<strong>不提供端点</strong> —— 契约 §2.2 的要求。
 * 现在只提供知识与状态查询，界面不得显示「已交给工作流」。</p>
 */
@RestController
@RequestMapping("/api/fx-techniques")
public class FxTechniqueController {

    private final FxTechniqueService service;

    public FxTechniqueController(FxTechniqueService service) {
        this.service = service;
    }

    /**
     * 技法列表。
     *
     * @param category      按用途分类筛选
     * @param execType      按源库声明的执行类型筛选
     * @param impl          按实现方式筛选
     * @param inputKind     按输入类型筛选
     * @param maxComplexity 复杂度上限
     * @param featured      只看精选
     * @param favorited     只看收藏
     * @param q             名称/英文名/用途/别名/检索词子串
     * @param sort          cat（默认）/ complexity / updated
     * @param cursor        游标
     * @param limit         每页数量
     * @return 分页结果
     */
    @GetMapping
    public PageResponse list(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String execType,
            @RequestParam(required = false) String impl,
            @RequestParam(required = false) String inputKind,
            @RequestParam(required = false) Integer maxComplexity,
            @RequestParam(required = false, defaultValue = "false") boolean featured,
            @RequestParam(required = false, defaultValue = "false") boolean favorited,
            @RequestParam(required = false) String q,
            @RequestParam(required = false, defaultValue = "cat") String sort,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "50") int limit) {
        Pagination.requireValidLimit(limit, "每页数量需在 1 到 " + Pagination.MAX_LIMIT + " 之间");
        int offset = Pagination.decodeOffsetCursor(cursor, "游标无效");
        FxQuery query = new FxQuery(
                FxStates.Category.fromWire(category),
                FxStates.ExecType.fromWire(execType),
                FxStates.Impl.fromWire(impl),
                FxStates.InputKind.fromWire(inputKind),
                maxComplexity,
                featured,
                favorited,
                blankToNull(q),
                sort,
                limit,
                offset);
        List<FxTechnique> found = service.search(query);
        int total = service.count(query);
        List<FxTechniqueResponse> items = found.stream()
                .map(t -> toResponse(t, service.userState(t.id())))
                .toList();
        String next = offset + found.size() < total
                ? Pagination.encodeCursor(offset + found.size())
                : null;
        return new PageResponse(items, next, total);
    }

    /** 筛选面与全量计数（不受当前筛选影响）。 */
    @GetMapping("/facets")
    public FacetsResponse facets() {
        var all = service.facets();
        return new FacetsResponse(service.total(), all.get("categories"), all.get("execTypes"),
                all.get("impls"), all.get("complexities"));
    }

    /** 技法详情。 */
    @GetMapping("/{techniqueId}")
    public FxTechniqueResponse get(@PathVariable String techniqueId) {
        FxTechnique technique = service.require(techniqueId);
        return toResponse(technique, service.userState(techniqueId));
    }

    /**
     * 更新用户状态（收藏 / 最近浏览）。
     *
     * <p>只改用户自己的标记，不动技法数据本身。</p>
     */
    @PatchMapping("/{techniqueId}/state")
    public ResponseEntity<UserStateResponse> updateState(@PathVariable String techniqueId,
            @RequestBody(required = false) StateRequest request) {
        Boolean favorited = request == null ? null : request.favorited();
        boolean viewed = request != null && request.viewed();
        UserState state = service.updateState(techniqueId, favorited, viewed);
        return ResponseEntity.status(HttpStatus.OK).body(toUserState(state));
    }

    private static FxTechniqueResponse toResponse(FxTechnique t, UserState state) {
        return new FxTechniqueResponse(
                t.id(),
                t.name(),
                t.nameEn(),
                t.aliases(),
                t.keywords(),
                t.intent(),
                t.category().wire(),
                t.categoryLabel(),
                t.scenes(),
                t.antiScenes(),
                t.execType().wire(),
                t.execLabel(),
                // 本机真实可执行状态；与 execType 无关。
                t.executionStatus().wire(),
                t.impl().wire(),
                t.implLabel(),
                t.complexity(),
                t.inputKinds().stream().map(FxStates.InputKind::wire).toList(),
                t.inputLabels(),
                t.inputRequirement(),
                t.output(),
                t.dependencies(),
                t.steps(),
                t.compatibility(),
                t.limitations(),
                t.failures(),
                t.params().stream()
                        .map(p -> new ParamResponse(p.key(), p.label(), p.value(), p.hint()))
                        .toList(),
                t.previewImageUrl(),
                t.previewVideoUrl(),
                t.previewCaption(),
                t.related(),
                t.alternatives(),
                t.featured(),
                t.version(),
                t.updatedAt() == null ? null : t.updatedAt().toString(),
                t.demo(),
                /* 来源与许可原样透传：界面要显示「这条从哪来、能不能商用」。
                   留空的字段就是「不知道」，不要在前端补默认文案。 */
                t.sourceKind(),
                t.sourceProject(),
                t.sourceUrl(),
                t.sourceVersion(),
                t.licenseCode(),
                t.licensePreview(),
                t.attribution(),
                t.sourcePath(),
                t.importedAt() == null ? null : t.importedAt().toString(),
                toUserState(state));
    }

    private static UserStateResponse toUserState(UserState state) {
        return new UserStateResponse(state.favorited(),
                state.lastViewedAt() == null ? null : state.lastViewedAt().toString());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /**
     * 分页结果。
     *
     * @param items      当前页
     * @param nextCursor 下一页游标；没有更多为 null
     * @param total      满足条件的总数
     */
    public record PageResponse(List<FxTechniqueResponse> items, String nextCursor, int total) {
    }

    /**
     * 筛选面。
     *
     * @param total        技法总数
     * @param categories   分类 → 条数
     * @param execTypes    执行类型 → 条数
     * @param impls        实现方式 → 条数
     * @param complexities 复杂度 → 条数
     */
    public record FacetsResponse(
            int total,
            java.util.Map<String, Integer> categories,
            java.util.Map<String, Integer> execTypes,
            java.util.Map<String, Integer> impls,
            java.util.Map<String, Integer> complexities) {
    }

    /**
     * 状态更新请求。
     *
     * @param favorited 收藏与否；null 表示不改
     * @param viewed    是否记为刚浏览过
     */
    public record StateRequest(Boolean favorited, boolean viewed) {
    }
}
