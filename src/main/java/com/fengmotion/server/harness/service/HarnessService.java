package com.fengmotion.server.harness.service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import org.springframework.stereotype.Service;

import com.fengmotion.server.harness.client.DshLauncher;
import com.fengmotion.server.harness.client.DshModelCatalog;
import com.fengmotion.server.harness.config.HarnessProperties;
import com.fengmotion.server.harness.domain.HarnessCapabilities;
import com.fengmotion.server.harness.domain.HarnessDescriptor;

import lombok.RequiredArgsConstructor;

/**
 * 引擎探测与能力声明。
 *
 * <p>探测结果带缓存：每次请求都 spawn 一个 {@code dsh --version} 代价太高，
 * 而引擎可用性在分钟级内不会变化。缓存只保存「上次探测的结论」，
 * 不缓存任何对话数据。</p>
 *
 * <p><strong>探测失败不等于没有引擎</strong>：{@code dsh} 不在 PATH 时应返回
 * {@code unavailable} 并说明原因，而不是返回空列表让前端以为「本机没有装引擎」。</p>
 */
@Service
@RequiredArgsConstructor
public class HarnessService {

    /** 本机唯一的引擎 ID；DSH 通过 SDK 协议接入。 */
    public static final String DSH_ID = "dsh-sdk";

    private final HarnessProperties properties;
    private final DshLauncher launcher;
    private final DshModelCatalog catalog;

    /** 上次探测结果。 */
    private volatile Probe cached;

    /**
     * 引擎探测结果。
     *
     * @param descriptor 引擎描述
     * @param models     可用模型
     * @param cachedAt   探测时间
     */
    public record Probe(HarnessDescriptor descriptor, List<ModelEntry> models, Instant cachedAt) {
    }

    /**
     * 一个可用模型。
     *
     * @param id            模型 ID
     * @param label         展示名
     * @param isDefault     是否为默认模型
     * @param contextWindow 上下文窗口；未知时为 null
     * @param maxTokens     单次输出上限；未知时为 null
     */
    public record ModelEntry(
            String id,
            String label,
            boolean isDefault,
            Long contextWindow,
            Long maxTokens) {
    }

    /**
     * 获取引擎描述（带缓存）。
     *
     * @return 当前引擎描述
     */
    public Probe probe() {
        Probe current = cached;
        if (current != null && current.cachedAt()
                .plus(Duration.ofMillis(properties.getProbeCacheMs()))
                .isAfter(Instant.now())) {
            return current;
        }
        Probe fresh = doProbe();
        cached = fresh;
        return fresh;
    }

    /**
     * 获取全部引擎描述。
     *
     * @return 只有一个元素的列表（当前只接 DSH）
     */
    public List<HarnessDescriptor> listDescriptors() {
        return List.of(probe().descriptor());
    }

    /**
     * 获取指定引擎的可用模型。
     *
     * @param harnessId 引擎 ID
     * @return 模型列表；引擎不存在时为空
     */
    public List<ModelEntry> listModels(String harnessId) {
        if (!DSH_ID.equals(harnessId)) {
            return List.of();
        }
        return probe().models();
    }

    /**
     * 引擎是否真实可用。
     *
     * @return 探测状态为 {@code available} 时返回 true
     */
    public boolean isAvailable() {
        return probe().descriptor().status() == HarnessDescriptor.Status.AVAILABLE;
    }

    /** 真正执行一次探测。 */
    private Probe doProbe() {
        Instant now = Instant.now();

        if (!properties.isEnabled()) {
            return new Probe(descriptor(
                    HarnessDescriptor.Status.UNAVAILABLE,
                    null,
                    "引擎接入已在配置中关闭（fengmotion.harness.enabled=false）"), List.of(), now);
        }

        if (!launcher.isBinReachable()) {
            return new Probe(descriptor(
                    HarnessDescriptor.Status.UNAVAILABLE,
                    null,
                    "找不到 dsh 可执行文件：" + properties.getBin()), List.of(), now);
        }

        String version = launcher.probeVersion();
        if (version == null) {
            return new Probe(descriptor(
                    HarnessDescriptor.Status.UNAVAILABLE,
                    null,
                    "dsh 命令无法执行或返回非零退出码，请确认已安装并在 PATH 中"), List.of(), now);
        }

        // 版本能拿到说明命令可执行；模型配置的正确性由 provider/model 是否非空来表达。
        // 这里不做真实对话验证：那会消耗 token，且探测应是廉价、幂等的。
        if (properties.getProvider() == null || properties.getProvider().isBlank()
                || properties.getModel() == null || properties.getModel().isBlank()) {
            return new Probe(descriptor(
                    HarnessDescriptor.Status.MISCONFIGURED,
                    version,
                    "缺少 provider 或 model 配置，无法发起对话"), List.of(), now);
        }

        // 模型目录读 DSH 自己组合出的配置树（--dump-config），而不是只回显配置里的单个模型：
        // provider 下通常有十几个模型，只给一个会让前端的模型选择器形同虚设。
        List<DshModelCatalog.Entry> discovered = catalog.read(properties.getProvider());
        List<ModelEntry> models;
        if (discovered.isEmpty()) {
            // 读不到目录时如实只给「当前正在用的那一个」，并标记为默认；
            // 不编造一整份清单，也不假装「该引擎没有模型」。
            models = List.of(new ModelEntry(
                    properties.getModel(), properties.getModel(), true, null, null));
        } else {
            String active = properties.getModel();
            models = discovered.stream()
                    .map(e -> new ModelEntry(
                            e.id(),
                            e.label(),
                            e.id().equals(active),
                            e.contextWindow(),
                            e.maxTokens()))
                    .toList();
        }

        return new Probe(
                descriptor(HarnessDescriptor.Status.AVAILABLE, version, null),
                models,
                now);
    }

    /**
     * 构造引擎描述。
     *
     * <p>能力值全部如实填写：{@code streaming} 固定为 {@code commit}，
     * 因为 SDK 通道拿不到 token 级增量；{@code cancel} 固定为 {@code process}，
     * 因为协议没有取消方法。</p>
     */
    private HarnessDescriptor descriptor(HarnessDescriptor.Status status, String version, String note) {
        return new HarnessDescriptor(
                DSH_ID,
                "DeepSeek",
                "sdk",
                status,
                version,
                note,
                new HarnessCapabilities(
                        HarnessCapabilities.Streaming.COMMIT,
                        HarnessCapabilities.Cancel.PROCESS,
                        true,
                        true,
                        true));
    }
}
