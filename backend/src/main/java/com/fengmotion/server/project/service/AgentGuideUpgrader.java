package com.fengmotion.server.project.service;

import java.nio.file.Files;
import java.nio.file.Path;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import com.fengmotion.server.project.store.mapper.ProjectMapper;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 启动期把已有项目的 agent 指引升级到当前版本。
 *
 * <p><strong>为什么需要它</strong>：早期框架给每个项目写了一份
 * 「先想清楚分镜再写 JSON，一次提交整部片」的指引。那会把创作 agent
 * 引向文字卡片，与 workflow-v5 的 Prompt-first 方向相反。
 * 只改新建模板是不够的 —— 已有项目会继续按旧指引工作，
 * 用户打开老项目仍然得到受限的结果。</p>
 *
 * <p><strong>不覆盖用户改过的</strong>：判据是框架标记（见
 * {@link ProjectDirectoryService#GENERATED_MARKER}）。没有标记的文件
 * 一律跳过并记日志。覆盖用户手写的项目约定比留一份旧指引更糟。</p>
 *
 * <p>升级失败不影响启动：一个项目的目录可能已被用户删掉或没有权限，
 * 那不该让整个服务起不来。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AgentGuideUpgrader {

    private final ProjectMapper projects;
    private final ProjectDirectoryService directories;

    /**
     * 升级所有活跃项目的指引。
     */
    @EventListener(ApplicationReadyEvent.class)
    public void upgradeAll() {
        int written = 0;
        int updated = 0;
        int skipped = 0;
        for (var row : projects.findActiveRoots()) {
            Path root = Path.of(row.getRootPath()).toAbsolutePath().normalize();
            if (!Files.isDirectory(root)) {
                // 项目目录被删了：不动它，也不报错
                continue;
            }
            try {
                switch (directories.upgradeAgentGuide(root, row.getId())) {
                    case WRITTEN -> written++;
                    case UPDATED -> updated++;
                    case SKIPPED_USER_EDITED -> {
                        skipped++;
                        log.info("项目 {} 的 AGENTS.md 没有框架标记，视为用户自维护，未改动", row.getId());
                    }
                    default -> { }
                }
            } catch (RuntimeException failed) {
                log.warn("升级项目 {} 的 agent 指引失败：{}", row.getId(), failed.getMessage());
            }
        }
        if (written + updated + skipped > 0) {
            log.info("agent 指引升级：新写 {}，更新 {}，跳过用户自维护 {}", written, updated, skipped);
        }
    }
}
