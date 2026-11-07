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

    private static final org.slf4j.Logger LOG =
            org.slf4j.LoggerFactory.getLogger(HarnessProperties.class);


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
    /**
     * 流式桥接插件目录。
     *
     * <p>显式配置了就用配置值；留空则按「应用目录下的 dsh-plugin」推断 ——
     * 即 {@code <jar 所在目录>/dsh-plugin}。</p>
     *
     * <p>为什么不能直接写 {@code ${user.dir}/dsh-plugin}：安装态后端的工作目录
     * 是启动它的那个目录（实测是仓库根），不是应用目录。用 user.dir 会指向
     * 一个不存在的路径，插件因此从未被加载 —— 表现是 SSE 里永远没有
     * delta / reasoning 帧，而日志里没有任何报错（{@code writePluginOverlay}
     * 找不到 index.js 时只是返回 null 并静默跳过）。</p>
     *
     * @return 插件目录；找不到时返回 null（调用方退回整段到达模式）
     */
    public Path streamPluginPath() {
        if (streamPlugin != null && !streamPlugin.isBlank()) {
            return Path.of(streamPlugin);
        }
        /* 兜底：从自身 jar 的位置推应用目录。开发态（target/classes）与
           安装态（app/resources/backend/fengmotion-server.jar）都要能对上，
           所以向上找最多 4 层，命中 dsh-plugin 就用它。 */
        try {
            /* 只用字符串解析定位 jar，不构造 jar 内的 Path：
               `Path.of(jarUri)` 会抛 FileSystemNotFoundException: Provider "jar"
               not installed（Spring Boot 的嵌套 jar 文件系统未挂载），
               `Path.of(uri)` 对 "jar:file:/…" 又会抛 URI is not hierarchical。
               两条路都走不通，所以这里把 location 规范成普通文件路径再看。 */
            String loc = HarnessProperties.class.getProtectionDomain()
                    .getCodeSource().getLocation().toString();
            /* 实测 Spring Boot 3 的 code source 有三种写法，都要能剥成 jar 路径：
               · nested:/a/b.jar/!BOOT-INF/classes   （Boot 3.2+ 当前用的）
               · jar:file:/a/b.jar!/BOOT-INF/classes
               · file:/a/b.jar                       （直接跑 jar）
               统一规则：去掉协议前缀，截到第一个 "/!" 或 "!/" 之前。 */
            /* 注意：前缀可能叠加。实测 Boot 3 的原始串是
               "jar:nested:/…/fengmotion-server.jar/!BOOT-INF/classes/!/"，
               jar: 与 nested: 两层都有。所以必须反复剥离直到没有前缀，
               一次性遍历 list 只剥掉第一层，剩下的 "nested:" 会让下面的
               路径判断整体失效（表现为永远找不到插件）。 */
            boolean stripped = true;
            while (stripped) {
                stripped = false;
                for (String prefix : new String[]{"jar:", "nested:", "file:", "zip:"}) {
                    if (loc.startsWith(prefix)) {
                        loc = loc.substring(prefix.length());
                        stripped = true;
                        break;
                    }
                }
            }
            int bang = loc.indexOf("!/");
            if (bang < 0) {
                bang = loc.indexOf("/!");
            }
            if (bang >= 0) {
                loc = loc.substring(0, bang);
            }
            if (loc.startsWith("file:")) {
                loc = loc.substring(5);
            }
            Path self = Path.of(java.net.URLDecoder.decode(loc, java.nio.charset.StandardCharsets.UTF_8));
            Path dir = java.nio.file.Files.isDirectory(self) ? self : self.getParent();
            LOG.info("stream plugin: codeSource={} startDir={}", self, dir);
            /* 起点取 jar 自己所在目录，再向上找。安装态 jar 在
               app/resources/backend/，插件在 app/dsh-plugin（上两层）；
               开发态 classes 在 backend/target/classes/，插件在 backend/dsh-plugin
               （上三层）。两个都要命中，所以统一向上找，不写死层数。 */
            for (int i = 0; i < 8 && dir != null; i++) {
                Path candidate = dir.resolve("dsh-plugin");
                if (java.nio.file.Files.isRegularFile(candidate.resolve("index.js"))) {
                    LOG.info("stream plugin: 命中 {}", candidate);
                    return candidate;
                }
                dir = dir.getParent();
            }
            LOG.warn("stream plugin: 从 {} 向上未找到 dsh-plugin/index.js", self);
        } catch (Exception failure) {
            /* 推不出来就当没有：调用方退回整段到达，不编造路径。
               记下来原因 —— 否则界面上只是「没有逐字效果」，无从判断是路径推错
               还是有异常被吞掉。 */
            LOG.warn("stream plugin: 从 jar 位置推断插件目录失败，退回整段到达模式", failure);
        }
        return null;
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
