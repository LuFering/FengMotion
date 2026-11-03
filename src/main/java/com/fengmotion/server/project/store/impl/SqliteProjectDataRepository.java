package com.fengmotion.server.project.store.impl;

import com.fengmotion.server.project.store.ProjectDataRepository;
import com.fengmotion.server.project.store.mapper.ProjectDataMapper;
import com.fengmotion.server.project.store.mapper.ProjectRow;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Repository;

import lombok.RequiredArgsConstructor;

/**
 * 项目数据访问接口的 SQLite 实现。
 *
 * <p>负责选择 Mapper 语句并把数据库行转换为存储层对象；查询参数校验及 API 响应
 * 组装仍由服务层负责。</p>
 */
@Repository
@RequiredArgsConstructor
public class SqliteProjectDataRepository implements ProjectDataRepository {
    private final ProjectDataMapper mapper;

    /**
     * 按 ID 查询未归档项目。
     *
     * @param id 项目 ID
     * @return 找到时包含项目数据，否则为空
     */
    @Override
    public Optional<ProjectData> findActiveById(String id) {
        return Optional.ofNullable(mapper.findActiveById(id)).map(this::map);
    }

    /**
     * 按阶段和关键词查询未归档项目。
     *
     * <p>排序只通过枚举分支选择 Mapper 中三个固定 SQL 方法，用户输入不会出现在
     * {@code ORDER BY} 中。limit 和 offset 由 MyBatis 以绑定参数传入。</p>
     *
     * @param stage 项目阶段；为 null 时不按阶段筛选
     * @param keyword 名称或简介中的搜索词
     * @param sort 排序方式
     * @param limit 最多返回的记录数
     * @param offset 跳过的记录数
     * @return 符合条件的项目数据
     */
    @Override
    public List<ProjectData> findActive(String stage, String keyword, Sort sort, int limit, int offset) {
        List<ProjectRow> rows = switch (sort) {
            case UPDATED_DESC -> mapper.findActiveByUpdatedDesc(stage, keyword, limit, offset);
            case UPDATED_ASC -> mapper.findActiveByUpdatedAsc(stage, keyword, limit, offset);
            case NAME_ASC -> mapper.findActiveByNameAsc(stage, keyword, limit, offset);
        };
        return rows.stream().map(this::map).toList();
    }

    /**
     * 仅在项目未归档且当前 etag 匹配时更新项目。
     *
     * @param id 项目 ID
     * @param etag 调用方持有的原版本标识
     * @param changes 需要保存的项目字段
     * @param updatedAt 本次更新时间
     * @param nextEtag 更新成功后使用的新版本标识
     * @return 实际更新的行数；为 0 时表示没有匹配到记录
     */
    @Override
    public int updateIfMatch(String id, String etag, ProjectChanges changes, Instant updatedAt, String nextEtag) {
        return mapper.updateIfMatch(new ProjectDataMapper.ProjectUpdateParams(
                id, etag, changes.name(), changes.tagline(), changes.stage(), changes.genomeId(),
                changes.targetDurationMs(), updatedAt.toString(), nextEtag));
    }

    /**
     * 归档未归档的项目；已归档或不存在时返回 0。
     *
     * @param id         项目 ID
     * @param archivedAt 归档时间
     * @return 实际更新的行数
     */
    @Override
    public int archiveIfActive(String id, Instant archivedAt) {
        return mapper.archiveIfActive(id, archivedAt.toString());
    }

    /**
     * 将查询结果中的一行转换为项目数据。
     *
     * <p>{@code targetDurationMs} 在 SQL 中为 NULL 时，Mapper 读出的是 {@code null}，
     * 保持“未设置”的语义而不是 0。</p>
     *
     * @param row 数据库行
     * @return 转换后的项目数据
     */
    private ProjectData map(ProjectRow row) {
        return new ProjectData(row.getId(), row.getName(), row.getTagline(), row.getStage(), row.getGenomeId(),
                row.getTargetDurationMs(), row.getRootPath(), row.getCreatedAt(), row.getUpdatedAt(), row.getEtag());
    }
}
