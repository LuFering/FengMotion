package com.fengmotion.server.system.api;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fengmotion.server.harness.service.HarnessService;

import lombok.RequiredArgsConstructor;

/**
 * 服务状态与能力声明。
 *
 * <p>能力状态必须来自真实探测：{@code agent} 一项读 {@link HarnessService} 的探测结果，
 * 而不是硬编码。其余能力（编辑器、云渲染、语音识别等）在对应模块接入前保持
 * {@code unavailable}——声明未接入是诚实的，声明可用却做不到才是错的。</p>
 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class SystemController {

    private final HarnessService harness;

    private final long startedAt = System.nanoTime();

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok", "version", "0.1.0-SNAPSHOT",
                "uptimeMs", (System.nanoTime() - startedAt) / 1_000_000);
    }

    @GetMapping("/capabilities")
    public Map<String, Capability> capabilities() {
        return Map.of(
                "agent", agentCapability(),
                "remotionEditor", unavailable("服务端编辑器未接入"),
                "previewVideo", unavailable("服务端视频预览未接入"),
                "cloudRender", unavailable("云渲染未接入"),
                "referenceAnalysis", unavailable("参考片解析未接入"),
                "asr", unavailable("语音识别未接入"),
                "checkExecution", unavailable("检查执行未接入")
        );
    }

    /** Agent 能力：按真实探测结果声明，探测不到时说明原因而不是假装可用。 */
    private Capability agentCapability() {
        HarnessService.Probe probe = harness.probe();
        var descriptor = probe.descriptor();
        if (descriptor.status() == com.fengmotion.server.harness.domain.HarnessDescriptor.Status.AVAILABLE) {
            return new Capability("available", null);
        }
        String note = descriptor.note() == null ? "Agent 不可用" : descriptor.note();
        return unavailable(note);
    }

    private Capability unavailable(String note) {
        return new Capability("unavailable", note);
    }

    /**
     * 一项能力的声明。
     *
     * @param status 状态：{@code available} 或 {@code unavailable}
     * @param note   说明；可用时不出现（而不是给出一个空字符串）
     */
    public record Capability(
            String status,
            @JsonInclude(JsonInclude.Include.NON_NULL) String note) {
    }
}
