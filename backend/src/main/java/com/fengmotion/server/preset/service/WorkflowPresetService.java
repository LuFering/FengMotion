package com.fengmotion.server.preset.service;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.preset.domain.PresetMapping;
import com.fengmotion.server.preset.domain.WorkflowPreset;
import com.fengmotion.server.preset.store.WorkflowPresetRepository;
import com.fengmotion.server.skill.domain.SkillPackage;
import com.fengmotion.server.skill.store.SkillPackageRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 视频类型（工作流预设）的生成、审阅与启用。
 *
 * <p>状态只往前走：draft（可修改）→ active（只读，可落地到项目）→ archived。
 * 每次写入映射都要先过 {@link PresetMappingValidator}。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WorkflowPresetService {

    private final WorkflowPresetRepository presets;
    private final SkillPackageRepository packages;
    private final PresetMappingModel model;

    /**
     * 让模型为一个 skill 生成映射，校验通过后存成草稿。
     *
     * @param skillPackageId 来源 skill 包
     * @param skillPath      选中的 SKILL.md（包内路径）
     * @throws MappingInvalidException 模型输出不合法或没通过校验（422），不保存
     */
    public WorkflowPreset generate(String skillPackageId, String skillPath) {
        return generate(skillPackageId, skillPath, new GenerationProgress() { });
    }

    public SkillPackage requireSkill(String skillPackageId, String skillPath) {
        SkillPackage pkg = packages.findById(skillPackageId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "skill 包不存在"));
        if (skillPath == null || pkg.report().skills().stream().noneMatch(s -> s.path().equals(skillPath))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "这个 skill 包里没有 " + skillPath);
        }
        return pkg;
    }

    public boolean modelAvailable() { return model.available(); }

    public interface GenerationProgress {
        default void stage(String stage) { }
        default void collected(PresetMappingPrompt.Built built) { }
        default void save(WorkflowPreset preset, Runnable persist) { persist.run(); }
    }

    public WorkflowPreset generate(String skillPackageId, String skillPath, GenerationProgress progress) {
        SkillPackage pkg = requireSkill(skillPackageId, skillPath);
        progress.stage("collecting");

        PresetMappingPrompt.Built built;
        try {
            built = PresetMappingPrompt.build(pkg, skillPath);
        } catch (IOException unreadable) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "skill_unreadable", "skill 包文件读取失败，请重新导入");
        }
        progress.collected(built);
        progress.stage("calling_model");
        String output = model.generate(built.system(), built.prompt());
        progress.stage("validating");
        PresetMapping parsed = PresetMappingPrompt.parse(output);
        // truncatedSources 由后端填写，模型给的值一律不采信
        PresetMapping mapping = withTruncated(parsed, built.truncatedSources());

        var problems = PresetMappingValidator.validate(mapping, pkg.report(), skillPath);
        if (!problems.isEmpty()) {
            log.info("映射未通过校验：package={} skill={} 问题 {} 项", skillPackageId, skillPath, problems.size());
            throw new MappingInvalidException("模型生成的映射没有通过校验，未保存", problems);
        }

        Instant now = Instant.now();
        WorkflowPreset preset = new WorkflowPreset(UUID.randomUUID().toString(), mapping.name(), mapping.description(),
                WorkflowPreset.DRAFT, pkg.id(), pkg.owner() + "/" + pkg.repo(), skillPath, pkg.commitSha(), mapping,
                PresetMapping.VERSION, now, now, null);
        progress.stage("saving");
        requireSkill(skillPackageId, skillPath);
        progress.save(preset, () -> presets.save(preset));
        return preset;
    }

    /** @param status null 表示全部 */
    public List<WorkflowPreset> list(String status) {
        if (status != null && !List.of(WorkflowPreset.DRAFT, WorkflowPreset.ACTIVE, WorkflowPreset.ARCHIVED).contains(status)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "status 只能是 draft / active / archived / all");
        }
        return presets.find(status);
    }

    public WorkflowPreset get(String id) {
        return presets.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "视频类型不存在"));
    }

    /**
     * 用户修改草稿的映射。
     *
     * @throws ApiException 不是草稿（409 preset_not_editable）、来源 skill 包已删除无法校验（409 skill_package_missing）
     * @throws MappingInvalidException 没通过校验（422）
     */
    public WorkflowPreset updateMapping(String id, PresetMapping mapping) {
        WorkflowPreset preset = get(id);
        if (!preset.status().equals(WorkflowPreset.DRAFT)) {
            throw new ApiException(HttpStatus.CONFLICT, "preset_not_editable", "只有草稿可以修改；已启用的视频类型是只读的");
        }
        SkillPackage pkg = packages.findById(preset.skillPackageId())
                .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "skill_package_missing",
                        "来源 skill 包已删除，无法校验修改；请重新导入后再生成"));
        PresetMapping next = withTruncated(mapping, preset.mapping().truncatedSources());
        var problems = PresetMappingValidator.validate(next, pkg.report(), preset.skillPath(), preset.mappingVersion());
        if (!problems.isEmpty()) throw new MappingInvalidException("修改后的映射没有通过校验，未保存", problems);
        if (!presets.updateMapping(id, WorkflowPreset.DRAFT, next, preset.mappingVersion(), Instant.now())) {
            throw new ApiException(HttpStatus.CONFLICT, "preset_not_editable", "视频类型刚被启用或归档，修改未保存");
        }
        return get(id);
    }

    /** 草稿 → 启用。 */
    public WorkflowPreset activate(String id) {
        WorkflowPreset preset = get(id);
        if (preset.status().equals(WorkflowPreset.ACTIVE)) return preset;
        if (!preset.status().equals(WorkflowPreset.DRAFT)) {
            throw new ApiException(HttpStatus.CONFLICT, "preset_not_draft", "只有草稿可以启用");
        }
        SkillPackage pkg = packages.findById(preset.skillPackageId())
                .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "skill_package_missing", "来源 skill 包已删除，无法重新校验草稿"));
        var problems = PresetMappingValidator.validate(preset.mapping(), pkg.report(), preset.skillPath(), preset.mappingVersion());
        if (!problems.isEmpty()) throw new MappingInvalidException("草稿未通过当前校验，未启用；请修改或重新生成", problems);
        Instant now = Instant.now();
        if (!presets.updateStatus(id, WorkflowPreset.DRAFT, WorkflowPreset.ACTIVE, now, now)) {
            throw new ApiException(HttpStatus.CONFLICT, "preset_not_draft", "只有草稿可以启用");
        }
        return get(id);
    }

    /** 归档；已归档时什么都不做。已落地到项目的指引不受影响。 */
    public void archive(String id) {
        WorkflowPreset preset = get(id);
        if (preset.status().equals(WorkflowPreset.ARCHIVED)) return;
        if (!presets.updateStatus(id, preset.status(), WorkflowPreset.ARCHIVED, Instant.now(), null)) {
            throw new ApiException(HttpStatus.CONFLICT, "preset_conflict", "视频类型状态刚被修改，请刷新后重试");
        }
    }

    private static PresetMapping withTruncated(PresetMapping m, List<String> truncated) {
        if (m == null) throw new MappingInvalidException("映射为空", List.of(new PresetMappingValidator.Problem("", "映射为空")));
        return new PresetMapping(m.name(), m.description(), m.slug(), m.promptScaffold(), m.defaults(),
                m.requiredInputs(), m.lookdevTemplate(), m.filmPlanTemplate(), m.reviewChecklist(), m.guide(),
                m.components(), m.instructedCommands(), m.stepMapping(), m.unmapped(),
                truncated == null ? List.of() : List.copyOf(truncated));
    }
}
