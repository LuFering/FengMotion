package com.fengmotion.server.harness.api;

import java.time.Instant;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.harness.domain.HarnessDescriptor;
import com.fengmotion.server.harness.service.HarnessService;

import lombok.RequiredArgsConstructor;

/**
 * 执行引擎与模型的 HTTP 接口。
 *
 * <p>首页的引擎切换器直接消费这两个接口。数据来自对本机 {@code dsh} 的真实探测，
 * 不是硬编码：探测不到时返回 {@code unavailable} 并说明原因。</p>
 */
@RestController
@RequestMapping("/api/harnesses")
@RequiredArgsConstructor
public class HarnessController {

    private final HarnessService service;

    /**
     * 列出可用引擎及其能力。
     *
     * @return 引擎列表与探测时间
     */
    @GetMapping
    public HarnessListResponse list() {
        HarnessService.Probe probe = service.probe();
        return new HarnessListResponse(
                probe.descriptor() == null ? List.of() : List.of(toResponse(probe.descriptor())),
                probe.cachedAt());
    }

    /**
     * 列出指定引擎的可用模型。
     *
     * @param harnessId 引擎 ID
     * @return 模型列表
     * @throws ApiException 引擎不存在时 404
     */
    @GetMapping("/{harnessId}/models")
    public ModelListResponse models(@PathVariable String harnessId) {
        if (!HarnessService.DSH_ID.equals(harnessId)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "引擎不存在");
        }
        List<ModelEntryResponse> items = service.listModels(harnessId).stream()
                .map(m -> new ModelEntryResponse(
                        m.id(), m.label(), m.isDefault(), m.contextWindow(), m.maxTokens()))
                .toList();
        return new ModelListResponse(items);
    }

    /** 把领域描述转成对外响应。 */
    private HarnessResponse toResponse(HarnessDescriptor descriptor) {
        return new HarnessResponse(
                descriptor.id(),
                descriptor.name(),
                descriptor.kind(),
                descriptor.status().wireValue(),
                descriptor.version(),
                descriptor.note(),
                new CapabilitiesResponse(
                        descriptor.capabilities().streaming().wireValue(),
                        descriptor.capabilities().cancel().wireValue(),
                        descriptor.capabilities().resume(),
                        descriptor.capabilities().tools(),
                        descriptor.capabilities().reasoning()));
    }

    /**
     * 引擎列表响应。
     *
     * @param items    引擎条目
     * @param cachedAt 探测时间，供前端说明数据新鲜度
     */
    public record HarnessListResponse(List<HarnessResponse> items, Instant cachedAt) {
    }

    /**
     * 一个引擎的对外描述。
     *
     * @param id           引擎 ID
     * @param name         展示名
     * @param kind         引擎类型
     * @param status       可用性
     * @param version      版本；探测不到时不出现
     * @param note         状态说明；可用时不出现
     * @param capabilities 能力声明
     */
    public record HarnessResponse(
            String id,
            String name,
            String kind,
            String status,
            String version,
            String note,
            CapabilitiesResponse capabilities) {
    }

    /**
     * 引擎能力声明。
     *
     * @param streaming 流式粒度：{@code commit} 或 {@code token}
     * @param cancel    取消方式：{@code process} 或 {@code graceful}
     * @param resume    是否支持会话续接
     * @param tools     是否具备工具调用
     * @param reasoning 是否产出推理
     */
    public record CapabilitiesResponse(
            String streaming,
            String cancel,
            boolean resume,
            boolean tools,
            boolean reasoning) {
    }

    /**
     * 模型列表响应。
     *
     * @param items 模型条目
     */
    public record ModelListResponse(List<ModelEntryResponse> items) {
    }

    /**
     * 一个可用模型。
     *
     * @param id            模型 ID
     * @param label         展示名
     * @param isDefault     是否默认
     * @param contextWindow 上下文窗口；未知时不出现
     * @param maxTokens     输出上限；未知时不出现
     */
    public record ModelEntryResponse(
            String id,
            String label,
            boolean isDefault,
            Long contextWindow,
            Long maxTokens) {
    }
}
