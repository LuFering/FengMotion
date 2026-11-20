package com.fengmotion.server.preset.store;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.preset.domain.PresetMapping;
import com.fengmotion.server.preset.domain.WorkflowPreset;
import com.fengmotion.server.preset.store.mapper.WorkflowPresetMapper;
import com.fengmotion.server.preset.store.mapper.WorkflowPresetRow;

import lombok.RequiredArgsConstructor;

/** 使用 MyBatis 在 SQLite 中保存视频类型；映射以 JSON 文本保存。 */
@Repository
@RequiredArgsConstructor
public class SqliteWorkflowPresetRepository implements WorkflowPresetRepository {
    private final WorkflowPresetMapper mapper;
    private final ObjectMapper json;

    @Override
    public void save(WorkflowPreset p) {
        mapper.insert(new WorkflowPresetRow(p.id(), p.name(), p.description(), p.status(), p.skillPackageId(),
                p.sourceRepo(), p.skillPath(), p.commitSha(), write(p.mapping()), p.mappingVersion(),
                p.createdAt().toString(), p.updatedAt().toString(), p.activatedAt() == null ? null : p.activatedAt().toString()));
    }

    @Override
    public Optional<WorkflowPreset> findById(String id) {
        return Optional.ofNullable(mapper.findById(id)).map(this::toDomain);
    }

    @Override
    public List<WorkflowPreset> find(String status) {
        return (status == null ? mapper.findAll() : mapper.findByStatus(status)).stream().map(this::toDomain).toList();
    }

    @Override
    public boolean updateMapping(String id, String expected, PresetMapping mapping, int version, Instant at) {
        return mapper.updateMapping(id, expected, mapping.name(), mapping.description(), write(mapping),
                version, at.toString()) > 0;
    }

    @Override
    public boolean updateStatus(String id, String expected, String status, Instant at, Instant activatedAt) {
        return mapper.updateStatus(id, expected, status, at.toString(), activatedAt == null ? null : activatedAt.toString()) > 0;
    }

    private String write(PresetMapping mapping) {
        try {
            return json.writeValueAsString(mapping);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("无法序列化预设映射", e);
        }
    }

    private WorkflowPreset toDomain(WorkflowPresetRow r) {
        PresetMapping mapping;
        try {
            mapping = json.readValue(r.mappingJson(), PresetMapping.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("预设映射已损坏：" + r.id(), e);
        }
        return new WorkflowPreset(r.id(), r.name(), r.description(), r.status(), r.skillPackageId(), r.sourceRepo(),
                r.skillPath(), r.commitSha(), mapping, r.mappingVersion(), Instant.parse(r.createdAt()),
                Instant.parse(r.updatedAt()), r.activatedAt() == null ? null : Instant.parse(r.activatedAt()));
    }
}
