package com.fengmotion.server.preset.api;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.preset.domain.PresetMapping;
import com.fengmotion.server.preset.domain.WorkflowPreset;
import com.fengmotion.server.preset.service.WorkflowPresetService;

import lombok.RequiredArgsConstructor;

/** 视频类型（工作流预设）端点：从 skill 生成映射、审阅修改、启用、归档。 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class WorkflowPresetController {

    private final WorkflowPresetService service;

    /** 让模型为 skill 包里的一个 SKILL.md 生成映射；校验通过存成草稿（201），不通过 422 并附逐项问题。 */
    @PostMapping("/skill-packages/{packageId}/mappings")
    @ResponseStatus(HttpStatus.CREATED)
    public WorkflowPreset generate(@PathVariable String packageId, @RequestBody(required = false) GenerateRequest request) {
        if (request == null) throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "缺少请求体");
        return service.generate(packageId, request.skillPath());
    }

    /** 默认只返回启用中的；{@code status=all} 返回全部。 */
    @GetMapping("/workflow-presets")
    public List<WorkflowPreset> list(@RequestParam(defaultValue = "active") String status) {
        return service.list(status.equals("all") ? null : status);
    }

    @GetMapping("/workflow-presets/{id}")
    public WorkflowPreset get(@PathVariable String id) {
        return service.get(id);
    }

    @PutMapping("/workflow-presets/{id}/mapping")
    public WorkflowPreset updateMapping(@PathVariable String id, @RequestBody(required = false) PresetMapping mapping) {
        if (mapping == null) throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "缺少请求体");
        return service.updateMapping(id, mapping);
    }

    @PostMapping("/workflow-presets/{id}/activate")
    public WorkflowPreset activate(@PathVariable String id) {
        return service.activate(id);
    }

    @DeleteMapping("/workflow-presets/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void archive(@PathVariable String id) {
        service.archive(id);
    }

    /** @param skillPath skill 包里的 SKILL.md 路径 */
    public record GenerateRequest(String skillPath) {
    }
}
