package com.fengmotion.server.project.service;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.common.Pagination;
import com.fengmotion.server.project.api.dto.ProjectDetail;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import com.fengmotion.server.project.store.ProjectDataRepository;
import com.fengmotion.server.project.store.ProjectDataRepository.ProjectData;
import com.fengmotion.server.project.store.ProjectDataRepository.Sort;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;

/**
 * 提供项目详情和分页列表查询。
 *
 * <p>
 * 本类负责校验查询参数、处理分页游标及组装响应；具体数据库查询交给
 * {@link ProjectDataRepository}。归档项目不会出现在查询结果中。
 * </p>
 */
@Service
@RequiredArgsConstructor
public class ProjectQueryService {
    private final ProjectDataRepository repository; // 项目数据访问接口，由 Spring 注入具体实现
    private final com.fengmotion.server.project.store.ProjectSceneRepository scenes;

    /**
     * 查询单个未归档项目的详情。
     *
     * @param id 项目 ID
     * @return 项目详情
     * @throws ApiException 项目不存在或已归档时抛出 404
     */
    public ProjectDetail get(String id) {
        // 有结果时转换为响应对象；没有结果时返回项目不存在。
        var data = repository.findActiveById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        return map(data, scenes.find(id).map(com.fengmotion.server.project.domain.ProjectScene::film).orElse(null));
    }

    /**
     * 按条件查询未归档项目，并返回一页结果。
     *
     * @param stage  可选的项目阶段；空字符串视为不筛选
     * @param q      可选的名称或简介搜索词
     * @param sort   排序方式；未指定时按更新时间降序
     * @param cursor 上一页返回的游标；首次查询可不传
     * @param limit  每页数量，范围为 1 至 200
     * @return 当前页项目及下一页游标；没有下一页时游标为 null
     * @throws ApiException 查询参数无效时抛出 400
     */
    public Page list(String stage, String q, String sort, String cursor, int limit) {
        Pagination.requireValidLimit(limit, "项目查询参数无效");
        // 只接受列出的排序方式，由 store 层转换成具体的数据库排序条件。
        Sort order = switch (sort == null || sort.isEmpty() ? "updated_desc" : sort) {
            case "updated_desc" -> Sort.UPDATED_DESC;
            case "updated_asc" -> Sort.UPDATED_ASC;
            case "name_asc" -> Sort.NAME_ASC;
            default -> throw invalid();
        };
        // 空阶段表示不筛选；其他值必须是支持的项目阶段。
        if (stage != null && stage.isEmpty())
            stage = null;
        if (stage != null && !Set.of("idea", "draft", "editing", "rendering", "done").contains(stage))
            throw invalid();
        // 游标是经 URL 安全 Base64 编码的偏移量；未传游标时从第 0 条开始。
        int offset = Pagination.decodeOffsetCursor(cursor, "项目查询参数无效");
        // 空搜索词匹配所有项目；多取一条用于判断是否还有下一页。
        String keyword = q == null ? "" : q;
        var data = repository.findActive(stage, keyword, order, limit + 1, offset);
        var films = scenes.findCurrentFilms(data.stream().map(ProjectData::id).toList());
        List<ProjectDetail> rows = data.stream().map(item -> map(item, films.get(item.id()))).toList();
        // 有多取到的记录时，生成下一页偏移量，并从本页结果中去掉多取的记录。
        boolean more = rows.size() > limit;
        String next = more ? Pagination.encodeCursor(offset + limit) : null;
        return new Page(more ? rows.subList(0, limit) : rows, next);
    }

    private ProjectDetail map(ProjectData data, com.fasterxml.jackson.databind.JsonNode film) {
        // 项目目标时长可为空；设置对象中的基本类型使用 0 表示尚未指定。
        Long target = data.targetDurationMs();
        var summary = ProjectContentSummary.from(film);
        return new ProjectDetail(data.id(), data.name(), data.tagline(), data.stage(), data.genomeId(), summary.durationMs(), target,
                summary.counts(), null, data.rootPath(),
                data.createdAt(), data.updatedAt(), data.etag(),
                new ProjectDetail.Settings(summary.width(), summary.height(), summary.fps(), target == null ? 0 : target, data.genomeId()));
    }

    /** 创建统一的查询参数错误响应。 */
    private ApiException invalid() {
        return new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目查询参数无效");
    }

    /**
     * 一页项目查询结果。
     *
     * @param items      当前页项目
     * @param nextCursor 下一页游标；没有更多结果时为 null
     */
    public record Page(List<ProjectDetail> items, String nextCursor) {
    }
}
