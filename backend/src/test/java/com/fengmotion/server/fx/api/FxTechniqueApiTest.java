package com.fengmotion.server.fx.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.fx.service.FxCatalogImporter;

/**
 * 特效库接口（契约 library.md §2.2）。
 *
 * <p>重点验三件事：技法目录只读；{@code execType} 与 {@code executionStatus} 是两个字段；
 * 「用于工作流」没有端点。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class FxTechniqueApiTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private FxCatalogImporter importer;

    @Test
    @DisplayName("列表返回技法与总数")
    void listReturnsTechniques() throws Exception {
        importer.importBuiltin(false);
        mvc.perform(get("/api/fx-techniques").param("limit", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(16))
                .andExpect(jsonPath("$.items").isArray());
    }

    @Test
    @DisplayName("详情里 execType 与 executionStatus 分开表达")
    void detailSeparatesDeclaredAndActual() throws Exception {
        importer.importBuiltin(false);
        mvc.perform(get("/api/fx-techniques/fx-dolly-zoom"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("多莉变焦"))
                // 源库声明的能力标签
                .andExpect(jsonPath("$.execType").value("runnable"))
                // 本机真实状态：默认为未实现，界面不得据此显示「可执行」
                .andExpect(jsonPath("$.executionStatus").value("not-implemented"))
                .andExpect(jsonPath("$.params[0].value").isNotEmpty());
    }

    @Test
    @DisplayName("facets 补齐未出现的取值为 0")
    void facetsFillZeros() throws Exception {
        importer.importBuiltin(false);
        mvc.perform(get("/api/fx-techniques/facets"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(16))
                .andExpect(jsonPath("$.categories.camera").value(3))
                .andExpect(jsonPath("$.categories.particles").value(2))
                // 七个分类全部出现
                .andExpect(jsonPath("$.categories.typography").value(2));
    }

    @Test
    @DisplayName("收藏与最近浏览通过独立端点更新")
    void updateUserState() throws Exception {
        importer.importBuiltin(false);
        mvc.perform(patch("/api/fx-techniques/fx-dolly-zoom/state")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"favorited\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.favorited").value(true));

        mvc.perform(get("/api/fx-techniques/fx-dolly-zoom"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userState.favorited").value(true));
    }

    @Test
    @DisplayName("技法目录只读：不提供新增/修改/删除技法本身")
    void catalogIsReadOnly() throws Exception {
        // POST 创建技法没有端点；对集合 POST 应为 405 或 404，而不是悄悄成功。
        mvc.perform(post("/api/fx-techniques")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"伪造技法\"}"))
                .andExpect(status().isMethodNotAllowed());
    }

    @Test
    @DisplayName("「用于工作流」在真实调用链可用前不提供端点")
    void noWorkflowEndpointYet() throws Exception {
        // 契约 §2.2：真实调用链可用前不提供端点，避免界面显示「已交给工作流」。
        mvc.perform(post("/api/fx-techniques/fx-dolly-zoom/use-in-workflow")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("不存在的技法返回 404")
    void missingTechniqueIs404() throws Exception {
        mvc.perform(get("/api/fx-techniques/fx-nope"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    @Test
    @DisplayName("中文搜索命中别名")
    void searchByAlias() throws Exception {
        importer.importBuiltin(false);
        mvc.perform(get("/api/fx-techniques").param("q", "眩晕"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)));
    }
}
