package com.fengmotion.server.project.store.impl;

import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.mapper.ProjectMapper;
import com.fengmotion.server.project.store.mapper.ProjectRow;

import java.time.Instant;
import java.util.Optional;

import org.springframework.stereotype.Repository;

import lombok.RequiredArgsConstructor;

/**
 * 项目持久化接口的 SQLite 实现；SQL 与行映射由 {@link ProjectMapper} 承载。
 */
@Repository
@RequiredArgsConstructor
public class SqliteProjectRepository implements ProjectRepository {
    private final ProjectMapper mapper;

    /**
     * 插入新记录；相同 ID 会触发数据库主键约束。
     *
     * <p>{@code created_at}、{@code updated_at} 写入相同的创建时间，{@code etag}
     * 初始值等于项目 ID，与迁移前的行为一致。</p>
     */
    @Override
    public void save(Project project) {
        ProjectRow row = new ProjectRow();
        row.setId(project.id());
        row.setName(project.name());
        row.setGenomeId(project.genomeId());
        row.setTargetDurationMs(project.targetDurationMs());
        row.setRootPath(project.rootPath());
        row.setCreatedAt(project.createdAt().toString());
        row.setUpdatedAt(project.createdAt().toString());
        row.setEtag(project.id());
        mapper.insert(row);
    }

    /**
     * 将数据库行映射为项目；未找到时返回空 Optional。
     *
     * <p>查询不过滤 {@code archived}，保持既有语义。目标时长为 SQL NULL 时，
     * {@code Long} 字段通过 MyBatis 的 LongTypeHandler 保持为 null，不会变成 0。</p>
     */
    @Override
    public Optional<Project> findById(String id) {
        return Optional.ofNullable(mapper.findById(id)).map(row -> new Project(
                row.getId(),
                row.getName(),
                row.getGenomeId(),
                row.getTargetDurationMs(),
                row.getRootPath(),
                Instant.parse(row.getCreatedAt())));
    }
}
