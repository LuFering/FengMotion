package com.fengmotion.server.harness.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import com.fengmotion.server.harness.service.HarnessService;

/**
 * 验证引擎探测接口的契约。
 *
 * <p>测试 profile 把 {@code fengmotion.harness.enabled} 设为 false，因此这里断言的是
 * 「引擎未启用时如何如实表达不可用」这条路径，而不是真实 spawn {@code dsh}。
 * 真实链路的验证属于端到端手测，不放在单元测试里——测试不应依赖本机是否装了 dsh。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class HarnessApiTest {

    @Autowired
    private MockMvc mvc;

    /** 引擎未启用时，列表返回一条 unavailable 记录而不是空列表。 */
    @Test
    void listsDisabledEngineAsUnavailable() throws Exception {
        mvc.perform(get("/api/harnesses"))
                .andExpect(status().isOk())
                // 关键断言：不是空数组。返回空列表会让前端以为「本机没装引擎」，
                // 而真实原因是配置里关掉了接入。
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(HarnessService.DSH_ID))
                .andExpect(jsonPath("$.items[0].status").value("unavailable"))
                // 必须给出原因，否则用户无从排查。
                .andExpect(jsonPath("$.items[0].note").isNotEmpty())
                // 探测时间供前端说明数据新鲜度。
                .andExpect(jsonPath("$.cachedAt").exists());
    }

    /** 能力声明必须如实：SDK 通道拿不到 token 级流、取消只能杀进程。 */
    @Test
    void declaresHonestCapabilities() throws Exception {
        mvc.perform(get("/api/harnesses"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].capabilities.streaming").value("commit"))
                .andExpect(jsonPath("$.items[0].capabilities.cancel").value("process"))
                .andExpect(jsonPath("$.items[0].capabilities.resume").value(true))
                .andExpect(jsonPath("$.items[0].capabilities.tools").value(true));
    }

    /** 未知引擎的模型列表返回 404，不返回空列表冒充「该引擎没有模型」。 */
    @Test
    void unknownHarnessModelsIsNotFound() throws Exception {
        mvc.perform(get("/api/harnesses/{id}/models", "no-such-engine"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    /** 已知引擎在未启用时返回空模型列表（而不是 404：引擎本身是认识的）。 */
    @Test
    void disabledEngineHasNoModels() throws Exception {
        mvc.perform(get("/api/harnesses/{id}/models", HarnessService.DSH_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
    }
}
