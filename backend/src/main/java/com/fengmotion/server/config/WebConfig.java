package com.fengmotion.server.config;

import java.nio.file.Files;
import java.nio.file.Path;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web 层配置：跨域与本地素材静态映射。
 *
 * <p>开发期跨域：前端 dev server（5173）直接调本机 8080。
 * 生产环境由同源部署或网关处理，不依赖这里的白名单。</p>
 *
 * <p><strong>能力库静态资源</strong>：从 {@code capabilities/} 导入的特效条目，
 * 其海报图（如 lemo 的 {@code styles/art-deco/poster.jpg}）是真实存在于用户磁盘上的文件。
 * 若不给它们一个可访问的 URL，界面上这些卡片就全是黑的 —— 已实测过这种情况，
 * 看起来像「导入失败」，实际是图片地址根本没有后端能提供。</p>
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private static final Logger log = LoggerFactory.getLogger(WebConfig.class);

    /**
     * 能力库海报的对外访问前缀。
     *
     * <p>为什么带 {@code /api}：前端把所有地址都按 API base 解析
     * （base 本身以 {@code /api} 结尾），图片地址也会经过同一层。
     * 挂在根路径会得到 {@code /api/capability-assets/...} 而 404 —— 实测过。
     * 与其让前端为图片单独造一套 base 解析，不如让后端与既有约定对齐。</p>
     */
    public static final String CAPABILITY_PREFIX = "/api/capability-assets/";

    private final String[] allowedOrigins;
    private final String capabilitiesDir;

    public WebConfig(
            @Value("${fengmotion.cors.allowed-origins:http://localhost:5173}") String origins,
            @Value("${fengmotion.retrieval.capabilities-dir:}") String capabilitiesDir) {
        this.allowedOrigins = origins.split(",");
        this.capabilitiesDir = capabilitiesDir;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*");
        /* 海报图走独立前缀而不是 /api/**：它们不是 API 数据，
           但跨域取图同样需要放行，否则 dev 模式下浏览器会拦掉。 */
        registry.addMapping(CAPABILITY_PREFIX + "**")
                .allowedOrigins(allowedOrigins)
                .allowedMethods("GET", "OPTIONS");
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        if (capabilitiesDir == null || capabilitiesDir.isBlank()) {
            /* 未配置时什么都不挂：不存在的路径返回 404，界面按「没有预览图」降级，
               比挂一个不存在的目录更不容易误导。 */
            log.debug("未配置 capabilities 目录，跳过静态资源映射");
            return;
        }
        Path root = Path.of(capabilitiesDir).toAbsolutePath().normalize();
        if (!Files.isDirectory(root)) {
            log.warn("capabilities 目录不存在，能力库海报将无法显示：{}", root);
            return;
        }
        /* file: 前缀 + 结尾斜杠是 Spring 的硬要求：少了结尾斜杠会被当成
           单个文件而不是目录，结果一律 404 且报错信息不指向这里。 */
        String location = root.toUri().toString();
        if (!location.endsWith("/")) {
            location = location + "/";
        }
        registry.addResourceHandler(CAPABILITY_PREFIX + "**")
                .addResourceLocations(location)
                /* 海报基本不变，给一天缓存；导入新版本换了文件名也不会读旧图。 */
                .setCachePeriod(86_400);
        log.info("能力库静态资源已映射：{} -> {}", CAPABILITY_PREFIX, root);
    }
}
