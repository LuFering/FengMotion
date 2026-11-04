package com.fengmotion.server.reference.api;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.reference.service.ReferenceVideoService;

/**
 * 工作区级参考偏好（契约 library.md §5）：收藏与最近浏览。
 *
 * <p>收藏只是个人标记，<strong>不是「已审核 / 已采用」</strong>。
 * 偏好跨项目共享，不属于任何单个项目。</p>
 */
@RestController
@RequestMapping("/api/reference-preferences")
public class ReferencePreferenceController {

    private final ReferenceVideoService service;

    public ReferencePreferenceController(ReferenceVideoService service) {
        this.service = service;
    }

    /** 收藏与最近浏览。 */
    @GetMapping
    public PreferencesResponse get() {
        return new PreferencesResponse(service.favorites(), service.recent());
    }

    /**
     * 更新偏好。
     *
     * <p>只支持逐个片段地标记/取消收藏与记浏览（一次一个 ID），
     * 避免整表覆盖导致多窗口互相冲掉对方的改动。</p>
     */
    @PatchMapping
    public PreferencesResponse patch(@RequestBody PreferencesRequest request) {
        if (request == null || request.segmentId() == null || request.segmentId().isBlank()) {
            return get();
        }
        if (request.favorited() != null) {
            service.setFavorite(request.segmentId(), request.favorited());
        }
        if (request.viewed()) {
            service.touchRecent(request.segmentId());
        }
        return get();
    }

    /**
     * 偏好响应。
     *
     * @param favorites 收藏的片段 ID，最近标记的在前
     * @param recent    最近浏览的片段 ID，最多 50 条
     */
    public record PreferencesResponse(List<String> favorites, List<String> recent) {
    }

    /**
     * 偏好更新请求。
     *
     * @param segmentId 目标片段
     * @param favorited 收藏与否；null 表示不改
     * @param viewed    是否记一次浏览
     */
    public record PreferencesRequest(String segmentId, Boolean favorited, boolean viewed) {
    }
}
