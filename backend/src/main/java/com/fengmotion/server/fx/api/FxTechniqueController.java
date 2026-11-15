package com.fengmotion.server.fx.api;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.common.Pagination;
import com.fengmotion.server.fx.api.dto.FxTechniqueResponse;
import com.fengmotion.server.fx.api.dto.FxTechniqueResponse.ParamResponse;
import com.fengmotion.server.fx.api.dto.FxTechniqueResponse.UserStateResponse;
import com.fengmotion.server.fx.domain.FxParam;
import com.fengmotion.server.fx.domain.FxStates;
import com.fengmotion.server.fx.domain.FxTechnique;
import com.fengmotion.server.fx.service.FxCapabilityImporter;
import com.fengmotion.server.fx.service.FxTechniqueService;
import com.fengmotion.server.fx.service.capability.CapabilitySource;
import com.fengmotion.server.fx.store.FxTechniqueRepository;
import com.fengmotion.server.fx.store.FxTechniqueRepository.FxQuery;
import com.fengmotion.server.fx.store.FxTechniqueRepository.UserState;

/**
 * 特效库接口（契约 docs/contracts/library.md §2.2）。
 *
 * <p>技法目录只读：不提供新增/修改/删除技法本身。用户可改的只有收藏与最近浏览，
 * 走 {@code PATCH /fx-techniques/{id}/state}。</p>
 */
@RestController
@RequestMapping("/api/fx-techniques")
public class FxTechniqueController {

    private final FxTechniqueService service;
    private final FxCapabilityImporter importer;
    private final FxTechniqueRepository repository;

    public FxTechniqueController(FxTechniqueService service, FxCapabilityImporter importer,
            FxTechniqueRepository repository) {
        this.service = service;
        this.importer = importer;
        this.repository = repository;
    }

    /**
     * 技法列表。
     */
    @GetMapping
    public PageResponse list(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String execType,
            @RequestParam(required = false) String impl,
            @RequestParam(required = false) String inputKind,
            @RequestParam(required = false) Integer maxComplexity,
            @RequestParam(required = false) String sourceProject,
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
                offset,
                blankToNull(sourceProject));
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

    /** 来源仓库列表及数量统计。 */
    @GetMapping("/sources")
    public List<Map<String, Object>> listSources() {
        Map<String, Map<String, Integer>> facets = service.facets();
        Map<String, Integer> spMap = facets.getOrDefault("sourceProjects", Map.of());
        return spMap.entrySet().stream()
                .map(e -> Map.<String, Object>of("sourceProject", e.getKey(), "count", e.getValue()))
                .toList();
    }

    /** 预览仓库中的能力（只读解析，用于导入弹窗在导入前查看组件与代码）。 */
    @GetMapping("/scan-repo")
    public ResponseEntity<Map<String, Object>> scanRepo(@RequestParam(defaultValue = "all") String repo) {
        Path root = resolveCapabilitiesRoot();
        if (root == null) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("success", false, "message", "未找到本地 capabilities 目录"));
        }
        List<CapabilitySource.ParsedItem> items = importer.scanOnly(root, repo);
        List<Map<String, Object>> result = new ArrayList<>();
        for (CapabilitySource.ParsedItem item : items) {
            String code = "";
            List<String> cleanSteps = new ArrayList<>();
            List<String> props = new ArrayList<>();
            List<String> apis = new ArrayList<>();
            if (item.steps() != null) {
                for (String step : item.steps()) {
                    if (step.startsWith("__SOURCE_CODE__:\n")) {
                        code = step.substring("__SOURCE_CODE__:\n".length());
                    } else if (step.startsWith("可调参数：")) {
                        String p = step.substring("可调参数：".length());
                        props.addAll(List.of(p.split("、")));
                        cleanSteps.add(step);
                    } else if (step.startsWith("使用 API：")) {
                        String a = step.substring("使用 API：".length());
                        apis.addAll(List.of(a.split("、")));
                        cleanSteps.add(step);
                    } else {
                        cleanSteps.add(step);
                    }
                }
            }
            boolean exists = repository.findById(item.id()).isPresent();
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("id", item.id());
            m.put("name", item.name());
            m.put("nameEn", item.nameEn() == null ? "" : item.nameEn());
            m.put("category", item.categoryHint() == null ? "compositing" : item.categoryHint());
            m.put("intent", item.intent() == null ? "" : item.intent());
            m.put("sourceProject", item.sourceProject() == null ? "" : item.sourceProject());
            m.put("sourcePath", item.sourcePath() == null ? "" : item.sourcePath());
            m.put("code", code);
            m.put("props", props);
            m.put("apis", apis);
            m.put("steps", cleanSteps);
            m.put("alreadyImported", exists);
            result.add(m);
        }
        return ResponseEntity.ok(Map.of(
                "success", true,
                "repo", repo,
                "total", result.size(),
                "items", result
        ));
    }

    /** 导入预置能力库（remotion-scenes、video-shotcraft、lemo-opuscar 或全部）。 */
    @PostMapping("/import-preset")
    public ResponseEntity<Map<String, Object>> importPreset(@RequestParam(defaultValue = "all") String repo) {
        Path root = resolveCapabilitiesRoot();
        if (root == null) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("success", false, "message", "未找到本地 capabilities 目录"));
        }
        FxCapabilityImporter.ImportResult result = importer.importFrom(root);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "imported", result.imported(),
                "skipped", result.skipped(),
                "note", result.note() == null ? "" : result.note()
        ));
    }

    public record ImportCustomRequest(
            String sourceProject,
            String sourceUrl,
            List<CustomTechniqueItem> items
    ) {}

    public record CustomTechniqueItem(
            String id,
            String name,
            String nameEn,
            String intent,
            String category,
            String impl,
            String code,
            List<String> keywords,
            List<String> steps,
            List<String> props,
            String sourcePath
    ) {}

    /** 自定义导入 GitHub 解析条目。 */
    @PostMapping("/import-custom")
    public ResponseEntity<Map<String, Object>> importCustom(@RequestBody ImportCustomRequest req) {
        if (req == null || req.items() == null || req.items().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "导入条目列表为空"));
        }
        int count = 0;
        Instant now = Instant.now();
        String project = (req.sourceProject() == null || req.sourceProject().isBlank()) ? "github" : req.sourceProject();
        String url = req.sourceUrl() == null ? "" : req.sourceUrl();

        for (CustomTechniqueItem item : req.items()) {
            if (item.id() == null || item.id().isBlank() || item.name() == null || item.name().isBlank()) {
                continue;
            }
            List<String> steps = new java.util.ArrayList<>(item.steps() == null ? List.of() : item.steps());
            if (item.code() != null && !item.code().isBlank() && steps.stream().noneMatch(s -> s.startsWith("__SOURCE_CODE__:"))) {
                steps.add("__SOURCE_CODE__:\n" + item.code());
            }
            if (item.props() != null && !item.props().isEmpty() && steps.stream().noneMatch(s -> s.startsWith("可调参数："))) {
                steps.add("可调参数：" + String.join("、", item.props()));
            }

            FxStates.Category cat = FxCapabilityImporter.mapCategory(item.category() == null ? "" : item.category());
            FxTechnique t = new FxTechnique(
                    item.id(),
                    item.name(),
                    item.nameEn() == null ? "" : item.nameEn(),
                    List.of(),
                    item.keywords() == null ? List.of() : item.keywords(),
                    item.intent() == null ? "" : item.intent(),
                    cat,
                    cat.label(),
                    List.of(),
                    List.of(),
                    FxStates.ExecType.COMPOSABLE,
                    FxStates.ExecType.COMPOSABLE.label(),
                    FxStates.ExecutionStatus.NOT_IMPLEMENTED,
                    FxStates.Impl.COMPOSITE,
                    FxStates.Impl.COMPOSITE.label(),
                    2,
                    List.of(FxStates.InputKind.VIDEO),
                    List.of("视频"),
                    "",
                    "",
                    List.of(),
                    steps,
                    List.of(),
                    List.of(),
                    List.of(),
                    List.of(),
                    "",
                    null,
                    "",
                    List.of(),
                    List.of(),
                    false,
                    "1.0.0",
                    now,
                    false,
                    "github",
                    project,
                    url,
                    "",
                    "MIT",
                    "MIT",
                    "",
                    item.sourcePath() == null ? "" : item.sourcePath(),
                    now
            );
            repository.upsert(t);
            count++;
        }

        return ResponseEntity.ok(Map.of(
                "success", true,
                "imported", count,
                "sourceProject", project
        ));
    }

    private Path resolveCapabilitiesRoot() {
        for (String candidate : List.of("capabilities", "../capabilities", "../../capabilities")) {
            Path p = Path.of(candidate);
            if (Files.isDirectory(p)) {
                return p.toAbsolutePath().normalize();
            }
        }
        return null;
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
