package com.fengmotion.server;


import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * 后端启动类。
 *
 * 包结构按功能划分；目录归属和模块协作边界见 backend/ARCHITECTURE.md。
 * 每个功能包内部再分 api / service / domain。
 *
 * {@code @ConfigurationPropertiesScan} 让 {@code harness/config} 下的配置类
 * 无需逐个 {@code @EnableConfigurationProperties} 即可注入。
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@org.springframework.scheduling.annotation.EnableAsync
@org.springframework.scheduling.annotation.EnableScheduling
public class FengMotionServerApplication {
    public static void main(String[] args) {
        var application = new SpringApplication(FengMotionServerApplication.class);
        application.addInitializers(new com.fengmotion.server.config.BackendDataLease());
        application.run(args);
    }
}
