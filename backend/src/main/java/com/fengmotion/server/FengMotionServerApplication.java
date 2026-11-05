package com.fengmotion.server;

import com.fengmotion.server.config.StartupDirectories;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * 后端启动类。
 *
 * 包结构按功能划分：system（系统）、task（任务）、catalog（产物版本）、harness（执行引擎）、
 * workspace（工作目录）、upload（附件）、project（项目）；公共能力在 common 与 config。
 * 每个功能包内部再分 api / service / domain。
 *
 * {@code @ConfigurationPropertiesScan} 让 {@code harness/config} 下的配置类
 * 无需逐个 {@code @EnableConfigurationProperties} 即可注入。
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@org.springframework.scheduling.annotation.EnableAsync
public class FengMotionServerApplication {
    public static void main(String[] args) {
        // 必须先于 SpringApplication.run：SQLite 不会创建缺少的父目录，
        // 而数据源初始化发生在容器启动最早期。全新安装时目录并不存在。
        StartupDirectories.prepare(args);
        SpringApplication.run(FengMotionServerApplication.class, args);
    }
}
