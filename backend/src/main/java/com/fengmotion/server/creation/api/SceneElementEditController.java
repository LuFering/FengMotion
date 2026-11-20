package com.fengmotion.server.creation.api;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.creation.service.SceneElementEditService;
import com.fengmotion.server.project.domain.SceneElementEditRequest;

import lombok.RequiredArgsConstructor;

/** 场景版本元素的后端写回接口；前端可据此实现任意交互面板。 */
@RestController
@RequestMapping("/api/projects/{projectId}/scene/versions")
@RequiredArgsConstructor
public class SceneElementEditController {
    private final SceneElementEditService edits;

    @PostMapping("/{version}/edit")
    public ResponseEntity<EditResponse> edit(@PathVariable String projectId, @PathVariable long version,
                                             @RequestBody SceneElementEditRequest request) {
        if (request == null || request.baseVersion() == null || request.baseVersion() != version) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "路径版本与请求体 baseVersion 不一致");
        }
        var result = edits.edit(projectId, request);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new EditResponse(
                result.projectId(), result.version(), result.artifactPath(), result.sourceHash(),
                result.elementId(), new Properties(result.text())));
    }

    public record EditResponse(String projectId, long version, String artifactPath, String sourceHash,
                               String elementId, Properties properties) { }

    public record Properties(String text) { }
}
