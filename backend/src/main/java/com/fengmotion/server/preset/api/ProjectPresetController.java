package com.fengmotion.server.preset.api;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.preset.service.PresetApplyService;

import lombok.RequiredArgsConstructor;

/** 项目当前的视频类型：读取与落地。落地可以重复调用。 */
@RestController
@RequestMapping("/api/projects/{projectId}/workflow/preset")
@RequiredArgsConstructor
public class ProjectPresetController {

    private final PresetApplyService service;

    /** 没有落地过时 {@code record} 为 null。 */
    @GetMapping
    public CurrentResponse current(@PathVariable String projectId) {
        return new CurrentResponse(service.current(projectId));
    }

    @PostMapping
    public PresetApplyService.ApplyResult apply(@PathVariable String projectId, @RequestBody(required = false) ApplyRequest request) {
        if (request == null || request.presetId() == null || request.presetId().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "缺少 presetId");
        }
        return service.apply(projectId, request.presetId());
    }

    /** @param presetId 启用中的视频类型 */
    public record ApplyRequest(String presetId) {
    }

    /** @param record 项目当前的视频类型记录 */
    public record CurrentResponse(PresetApplyService.Record record) {
    }
}
