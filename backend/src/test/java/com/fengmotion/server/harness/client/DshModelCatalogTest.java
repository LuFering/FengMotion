package com.fengmotion.server.harness.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * 验证 {@code --dump-config} 的模型目录解析。
 *
 * <p>用真实的配置片段作为夹具（取自本机 {@code dsh --profile sdk --patch ... --dump-config}
 * 的实际输出结构），这样测试能覆盖真实缩进与字段组合，而不是一个理想化的假数据。</p>
 */
class DshModelCatalogTest {

    /** 一段接近真实输出的配置树：两个 provider，其中一个有多个模型。 */
    private static final String DUMP = """
            - id: llm-pi-ai
              name: '@deepseek-ai/dsh-llm-pi-ai'
              config:
                providers:
                  zhipu:
                    displayName: Zhipu GLM
                    apiKeyEnv: ZHIPU_API_KEY
                    models:
                      - id: glm-5.3-flash
                        name: glm-5.3-flash
                        input:
                          - text
                          - image
                  agent2api-ecs:
                    displayName: agent2api-ecs
                    apiKeyEnv: AGENT2API_ECS_API_KEY
                    baseURL: http://127.0.0.1:13067/v1
                    models:
                      - id: glm-5.3-flash
                        name: GLM-5.3-Flash
                        contextWindow: 1000000
                        maxTokens: 131072
                      - id: deepseek-v4.1-flash
                        name: DeepSeek-V4.1-Flash
                        contextWindow: 1000000
                        maxTokens: 128000
                      - id: kimi-k3
                        name: Kimi-K3
                        contextWindow: 1024000
                        maxTokens: 131072
            - id: agent-default-model
              name: '@deepseek-ai/dsh-agent-default-model'
              config:
                provider: agent2api-ecs
                model: deepseek-v4.1-flash
            """;

    /** 能读出目标 provider 的全部模型，且字段完整。 */
    @Test
    void readsAllModelsOfProvider() {
        List<DshModelCatalog.Entry> entries = DshModelCatalog.parseProviderModels(DUMP, "agent2api-ecs");

        assertEquals(3, entries.size());
        assertEquals("glm-5.3-flash", entries.get(0).id());
        assertEquals("GLM-5.3-Flash", entries.get(0).label());
        assertEquals(1_000_000L, entries.get(0).contextWindow());
        assertEquals(131_072L, entries.get(0).maxTokens());

        assertEquals("deepseek-v4.1-flash", entries.get(1).id());
        assertEquals("DeepSeek-V4.1-Flash", entries.get(1).label());

        assertEquals("kimi-k3", entries.get(2).id());
    }

    /** 只读目标 provider，不会把另一个 provider 的模型混进来。 */
    @Test
    void isolatesProvider() {
        List<DshModelCatalog.Entry> zhipu = DshModelCatalog.parseProviderModels(DUMP, "zhipu");

        assertEquals(1, zhipu.size());
        assertEquals("glm-5.3-flash", zhipu.get(0).id());
        // 该模型没有 contextWindow / maxTokens，应如实为 null，而不是编造 0。
        assertNull(zhipu.get(0).contextWindow());
        assertNull(zhipu.get(0).maxTokens());
    }

    /** 未知 provider 返回空列表，不抛异常。 */
    @Test
    void unknownProviderYieldsEmpty() {
        assertTrue(DshModelCatalog.parseProviderModels(DUMP, "no-such-provider").isEmpty());
    }

    /** 配置里没有 llm-pi-ai 条目时返回空列表。 */
    @Test
    void missingEntryYieldsEmpty() {
        assertTrue(DshModelCatalog.parseProviderModels("- id: something-else\n  name: x\n", "agent2api-ecs")
                .isEmpty());
    }

    /** 模型缺少 name 时，label 回落到 id（不返回 null 或空串）。 */
    @Test
    void labelFallsBackToId() {
        String minimal = """
                - id: llm-pi-ai
                  name: '@deepseek-ai/dsh-llm-pi-ai'
                  config:
                    providers:
                      acme:
                        models:
                          - id: bare-model
                """;
        List<DshModelCatalog.Entry> entries = DshModelCatalog.parseProviderModels(minimal, "acme");

        assertEquals(1, entries.size());
        assertEquals("bare-model", entries.get(0).label());
    }

    /** 带引号的标量会被去掉引号。 */
    @Test
    void stripsQuotes() {
        String quoted = """
                - id: llm-pi-ai
                  config:
                    providers:
                      acme:
                        models:
                          - id: 'quoted-model'
                            name: "Quoted Model"
                """;
        List<DshModelCatalog.Entry> entries = DshModelCatalog.parseProviderModels(quoted, "acme");

        assertEquals(1, entries.size());
        assertEquals("quoted-model", entries.get(0).id());
        assertEquals("Quoted Model", entries.get(0).label());
    }

    /** 同一模型重复出现时只保留一条（配置层叠加可能产生重复）。 */
    @Test
    void deduplicatesSameId() {
        String dup = """
                - id: llm-pi-ai
                  config:
                    providers:
                      acme:
                        models:
                          - id: same-model
                            name: First
                          - id: same-model
                            name: Second
                """;
        List<DshModelCatalog.Entry> entries = DshModelCatalog.parseProviderModels(dup, "acme");

        assertEquals(1, entries.size());
        // 后写覆盖前写，与配置层叠加的语义一致。
        assertEquals("Second", entries.get(0).label());
    }
}
