package com.fengmotion.server.fx.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 启动期把内置技法目录导入库。
 *
 * <p>为什么在启动时导入而不是让界面触发：技法目录是**只读的参考数据**，没有「用户还没导入」
 * 这种状态 —— 库是空的只意味着后端还没准备好，界面这时候应该显示技法，而不是一个
 * 需要用户点一下「导入」的空页面。</p>
 *
 * <p>已有数据时不重复导入（幂等，且不会覆盖 executionStatus 这类本机事实）。</p>
 */
@Component
public class FxCatalogBootstrap {

    private static final Logger log = LoggerFactory.getLogger(FxCatalogBootstrap.class);

    private final FxCatalogImporter importer;

    public FxCatalogBootstrap(FxCatalogImporter importer) {
        this.importer = importer;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void importIfEmpty() {
        try {
            if (!importer.isEmpty()) {
                log.debug("特效目录已有数据，跳过导入");
                return;
            }
            FxCatalogImporter.ImportResult result = importer.importBuiltin(false);
            log.info("已导入内置特效目录：{} 条（跳过 {}）", result.imported(), result.skipped());
        } catch (RuntimeException ex) {
            // 导入失败不该让后端起不来：素材、项目等功能仍然可用，
            // 只是特效库为空 —— 这种局部不可用比整个服务不可用要好。
            log.error("导入内置特效目录失败，特效库将不可用", ex);
        }
    }
}
