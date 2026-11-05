package com.fengmotion.server.retrieval;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 启动后把三库与 capabilities 写进语义索引。
 *
 * <p><strong>为什么在启动后异步跑</strong>：首次索引要调几百次 embedding，
 * 放在启动路径里会让应用几十秒打不开。异步跑完之前，检索退回字面匹配，
 * 用户不会因为「索引还没建好」就用不了应用。</p>
 *
 * <p><strong>内容没变不重算</strong>：{@link SemanticIndex} 按内容哈希跳过已有条目，
 * 所以第二次启动几乎零成本。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SemanticIndexBootstrapper {

    private final RetrievalCorpus corpus;
    private final SemanticIndex index;

    @Value("${fengmotion.retrieval.enabled:true}")
    private boolean enabled;

    /**
     * 应用就绪后建索引。
     */
    @Async
    @EventListener(ApplicationReadyEvent.class)
    public void buildOnStartup() {
        if (!enabled) {
            log.info("语义检索已关闭（fengmotion.retrieval.enabled=false）");
            return;
        }
        long startedAt = System.currentTimeMillis();
        try {
            var docs = corpus.collect();
            if (docs.isEmpty()) {
                log.info("语义索引：没有可索引内容");
                return;
            }
            int written = index.upsert(docs);
            log.info("语义索引就绪：{} 段待索引，本次写入 {} 段，耗时 {}ms",
                    docs.size(), written, System.currentTimeMillis() - startedAt);
        } catch (RuntimeException failed) {
            /* 索引失败不影响应用可用：检索会退回字面匹配。 */
            log.warn("语义索引构建失败，检索退回字面匹配：{}", failed.getMessage());
        }
    }
}
