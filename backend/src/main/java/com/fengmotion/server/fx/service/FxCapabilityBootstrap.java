package com.fengmotion.server.fx.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;

/**
 * 启动期把 {@code capabilities/} 里的开源技能库导入特效库。
 *
 * <p>为什么和内置目录分成两个 Bootstrap：两者的失败语义不同。
 * 内置目录缺失说明安装包坏了；能力库缺失只说明用户没配那个目录，
 * 属于正常情况，不该报 error 让人以为出问题了。</p>
 *
 * <p>为什么放在启动而不是等用户点「导入」：这些条目是<strong>可检索的参考数据</strong>，
 * 语义索引里早就有它们（能搜到），但目录里没有（点不进去）。那种「搜得到、打不开」
 * 的状态比没有更让人困惑，所以一启动就补齐。</p>
 */
@Component
@RequiredArgsConstructor
public class FxCapabilityBootstrap {

    private static final Logger log = LoggerFactory.getLogger(FxCapabilityBootstrap.class);

    private final FxCapabilityImporter importer;

    @EventListener(ApplicationReadyEvent.class)
    public void importCapabilities() {
        try {
            FxCapabilityImporter.ImportResult result = importer.importAll();
            if (result.note() != null) {
                /* 未配置目录是正常情况：用 info，并且说清「本轮没有导入」，
                   不要让日志看起来像成功导入了 0 条。 */
                log.info("能力库未导入：{}", result.note());
                return;
            }
            log.info("能力库导入完成：{} 条（跳过 {}）", result.imported(), result.skipped());
        } catch (RuntimeException ex) {
            /* 导入失败不该让后端起不来：内置技法、素材、项目仍然可用，
               只是能力库条目缺失。局部不可用优于整体不可用。 */
            log.error("导入能力库失败，相关条目将不可用", ex);
        }
    }
}
