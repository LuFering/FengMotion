package com.fengmotion.server.harness.config;

import java.nio.file.Path;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.Getter;
import lombok.Setter;

/**
 * DSH 引擎的接入配置。
 *
 * <p>全部通过 {@code application.yml} 的 {@code fengmotion.harness.*} 注入，
 * 不在代码里硬编码本机路径——换一台机器只需要改配置。</p>
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "fengmotion.harness")
public class HarnessProperties {

    /** 是否启用引擎接入；关闭时相关接口如实返回不可用，而不是假装成功。 */
    private boolean enabled = true;

    /** {@code dsh} 可执行文件；可写绝对路径或裸命令名。 */
    private String bin = "dsh";

    /** 使用的 dsh profile。 */
    private String profile = "sdk";

    /** 可选的 patch 文件路径；用于让 SDK 子进程带上第三方提供商的 provider 配置。 */
    private String patch;

    /**
     * 流式桥接插件目录。
     *
     * <p>插件订阅 DSH 内部的 token 级帧并转写到 stderr，后端据此产出 SSE delta。
     * 留空时关闭 token 级流式，退回「整段到达」的行为。</p>
     */
    private String streamPlugin;

    /**
     * 流式插件目录。
     *
     * @return 路径；未配置时返回 null
     */
    public Path streamPluginPath() {
        return streamPlugin == null || streamPlugin.isBlank() ? null : Path.of(streamPlugin);
    }

    /** 子进程工作目录；留空时使用服务进程当前目录。 */
    private String workingDirectory;

    /** 模型路由名，例如 {@code agent2api-ecs}。 */
    private String provider = "agent2api-ecs";

    /** 模型 ID，例如 {@code deepseek-v4.1-flash}。 */
    private String model = "deepseek-v4.1-flash";

    /** 探测超时（毫秒）；探测结果会缓存，避免每次请求都 spawn 进程。 */
    private long probeTimeoutMs = 5_000;

    /** 探测结果缓存时长（毫秒）。 */
    private long probeCacheMs = 60_000;

    /** 单次对话的硬超时（毫秒）；超时后销毁子进程并发错误帧，不静默结束。 */
    private long turnTimeoutMs = 180_000;

    /**
     * patch 文件路径。
     *
     * @return 路径对象；未配置时返回 null
     */
    public Path patchPath() {
        return patch == null || patch.isBlank() ? null : Path.of(patch);
    }

    /**
     * 子进程工作目录。
     *
     * @return 配置的目录；未配置时为当前工作目录
     */
    public Path workingDirectory() {
        return workingDirectory == null || workingDirectory.isBlank()
                ? Path.of(System.getProperty("user.dir"))
                : Path.of(workingDirectory);
    }
}
