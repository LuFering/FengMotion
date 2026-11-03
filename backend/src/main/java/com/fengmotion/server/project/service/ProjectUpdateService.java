package com.fengmotion.server.project.service;

import com.fengmotion.server.common.ApiException;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import com.fengmotion.server.project.store.ProjectDataRepository;
import com.fengmotion.server.project.store.ProjectDataRepository.ProjectChanges;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProjectUpdateService {
    private static final Set<String> FIELDS = Set.of("name", "tagline", "stage", "genomeId", "targetDurationMs");
    private final ProjectDataRepository repository;
    private final ProjectQueryService query;
    public ProjectUpdateService(ProjectDataRepository repository, ProjectQueryService query) { this.repository = repository; this.query = query; }

    @Transactional
    public com.fengmotion.server.project.api.dto.ProjectDetail update(String id, String etag, Map<String, Object> values) {
        if (etag == null || etag.isBlank()) throw new ApiException(HttpStatus.PRECONDITION_FAILED, "precondition_failed", "缺少 If-Match");
        if (!FIELDS.containsAll(values.keySet())) throw invalid();
        var current = query.get(id);
        if (!etag.equals(current.etag())) throw new ApiException(HttpStatus.PRECONDITION_FAILED, "precondition_failed", "项目已被修改");
        Object name = values.getOrDefault("name", current.name());
        Object tagline = values.getOrDefault("tagline", current.tagline());
        Object stage = values.getOrDefault("stage", current.stage());
        Object genome = values.getOrDefault("genomeId", current.genomeId());
        Object duration = values.getOrDefault("targetDurationMs", current.targetDurationMs());
        if (!(name instanceof String n) || n.isBlank() || n.length() > 200 || !(tagline instanceof String)
                || !(stage instanceof String s) || !Set.of("idea", "draft", "editing", "rendering", "done").contains(s)
                || (genome != null && !(genome instanceof String))
                || (duration != null && (!(duration instanceof Integer || duration instanceof Long) || ((Number) duration).longValue() < 0))) throw invalid();
        String nextEtag = UUID.randomUUID().toString();
        ProjectChanges changes = new ProjectChanges((String) name, (String) tagline, (String) stage,
                (String) genome, duration == null ? null : ((Number) duration).longValue());
        int changed = repository.updateIfMatch(id, etag, changes, Instant.now(), nextEtag);
        if (changed == 0) throw new ApiException(HttpStatus.PRECONDITION_FAILED, "precondition_failed", "项目已被修改");
        return query.get(id);
    }

    /**
     * 归档项目：项目行与目录都保留，只是不再出现在查询与列表里。
     *
     * <p>契约 project.md §3.5 要求删除前检查未完成任务；任务域尚未接入，无法证明
     * 「没有任务在跑」，因此这里没有静默放行，也没有假装检查过——调用方
     * {@code ProjectController} 在物理删除（{@code purge=true}）时仍然返回
     * {@code capability_unavailable}，归档则只处理项目本身。</p>
     *
     * @param id 项目 ID
     * @throws ApiException 项目不存在或已归档时抛出 404
     */
    public void archive(String id) {
        if (repository.archiveIfActive(id, Instant.now()) == 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在");
        }
    }

    private ApiException invalid() { return new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目更新参数无效"); }
}
