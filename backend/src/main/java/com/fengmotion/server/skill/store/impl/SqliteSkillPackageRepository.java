package com.fengmotion.server.skill.store.impl;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.skill.domain.SkillInventory;
import com.fengmotion.server.skill.domain.SkillPackage;
import com.fengmotion.server.skill.store.SkillPackageRepository;
import com.fengmotion.server.skill.store.mapper.SkillPackageMapper;
import com.fengmotion.server.skill.store.mapper.SkillPackageRow;

import lombok.RequiredArgsConstructor;

/** 使用 MyBatis 在 SQLite 中登记 skill 包；报告以 JSON 文本保存。 */
@Repository
@RequiredArgsConstructor
public class SqliteSkillPackageRepository implements SkillPackageRepository {
    private final SkillPackageMapper mapper;
    private final ObjectMapper json;

    @Override
    public void save(SkillPackage pkg) {
        String report;
        try {
            report = json.writeValueAsString(pkg.report());
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("无法序列化 skill 包报告", e);
        }
        mapper.insert(new SkillPackageRow(pkg.id(), pkg.owner(), pkg.repo(), pkg.requestedRef(), pkg.commitSha(),
                pkg.subPath(), pkg.rootDir(), pkg.fileCount(), pkg.totalBytes(), report, pkg.importedAt().toString()));
    }

    @Override
    public Optional<SkillPackage> findById(String id) {
        return Optional.ofNullable(mapper.findById(id)).map(this::toDomain);
    }

    @Override
    public Optional<SkillPackage> findByIdentity(String owner, String repo, String commitSha, String subPath) {
        return Optional.ofNullable(mapper.findByIdentity(owner, repo, commitSha, subPath)).map(this::toDomain);
    }

    @Override
    public List<SkillPackage> findAll() {
        return mapper.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public boolean delete(String id) {
        return mapper.delete(id) > 0;
    }

    private SkillPackage toDomain(SkillPackageRow row) {
        SkillInventory report = null;
        if (row.reportJson() != null) {
            try {
                report = json.readValue(row.reportJson(), SkillInventory.class);
            } catch (JsonProcessingException e) {
                throw new IllegalStateException("skill 包报告已损坏：" + row.id(), e);
            }
        }
        return new SkillPackage(row.id(), row.owner(), row.repo(), row.requestedRef(), row.commitSha(),
                row.subPath(), row.rootDir(), row.fileCount(), row.totalBytes(), report,
                Instant.parse(row.importedAt()));
    }
}
