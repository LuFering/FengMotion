package com.fengmotion.server.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 开发期跨域：前端 dev server（5173）直接调本机 8080。
 * 生产环境由同源部署或网关处理，不依赖这里的白名单。
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final String[] allowedOrigins;
    // @Value("${配置项名称:默认值}"): 配置中的 fengmotion.cors.allowed-origins 注入到 origins 参数
    public WebConfig(@Value("${fengmotion.cors.allowed-origins:http://localhost:5173}") String origins) {
        this.allowedOrigins = origins.split(",");
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) { // 将跨域规则登记到由 spring mvc 创建的 registry
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*");
    }
}
