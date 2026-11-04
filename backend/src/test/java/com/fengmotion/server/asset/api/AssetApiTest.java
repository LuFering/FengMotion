package com.fengmotion.server.asset.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 素材接口（契约 asset.md §3）。
 *
 * <p>重点验三件用户看得见的事：拖拽/选择导入能拿到可访问的文件地址；
 * 按路径导入如实返回不可用而不是假装成功；审核与授权在响应里是两个独立字段。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class AssetApiTest {

    @Autowired
    private MockMvc mvc;

    private String uploadText(String name, String body) throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", name, "text/plain",
                body.getBytes(StandardCharsets.UTF_8));
        String json = mvc.perform(multipart("/api/assets").file(file))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json;
    }

    @Test
    @DisplayName("上传后能取回文件本体与完整状态字段")
    void uploadThenFetchContent() throws Exception {
        String json = uploadText("a.txt", "content-here");
        String id = com.jayway.jsonpath.JsonPath.read(json, "$.asset.id");

        mvc.perform(get("/api/assets/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mediaType").value("doc"))
                .andExpect(jsonPath("$.sourceType").value("imported"))
                .andExpect(jsonPath("$.processingStatus").value("pending"))
                // 新导入是「从未提审」，不是「待审」。
                .andExpect(jsonPath("$.reviewStatus").value("none"))
                .andExpect(jsonPath("$.availability").value("enabled"))
                // 授权独立且默认未知。
                .andExpect(jsonPath("$.licenseStatus").value("unknown"))
                .andExpect(jsonPath("$.etag").isNotEmpty());

        mvc.perform(get("/api/assets/" + id + "/content"))
                .andExpect(status().isOk())
                .andExpect(content().string("content-here"));
    }

    @Test
    @DisplayName("按路径导入如实返回 422，不假装成功")
    void pathImportReportsUnavailable() throws Exception {
        mvc.perform(post("/api/assets/import")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"filePath\":\"/tmp/x.png\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("capability_unavailable"));
    }

    @Test
    @DisplayName("列表按类型筛选并按 total 给出总数")
    void listFiltersAndCounts() throws Exception {
        uploadText("one.txt", "1");
        uploadText("two.txt", "2");

        mvc.perform(get("/api/assets").param("mediaType", "doc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").isNumber())
                .andExpect(jsonPath("$.items").isArray());

        mvc.perform(get("/api/assets").param("mediaType", "video"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));
    }

    @Test
    @DisplayName("facets 给出全量计数且补齐未出现的取值")
    void facetsIncludeZeroCounts() throws Exception {
        mvc.perform(get("/api/assets/facets"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").isNumber())
                // 即使没有任何视频素材，video 也应出现且为 0，否则筛选面板会缺选项。
                .andExpect(jsonPath("$.mediaTypes.video").value(0))
                .andExpect(jsonPath("$.reviewStatus.needs_review").value(0))
                .andExpect(jsonPath("$.licenseStatus.unknown").isNumber());
    }

    @Test
    @DisplayName("非法审核跳转返回 409 与稳定错误码")
    void illegalReviewTransitionReturns409() throws Exception {
        String json = uploadText("b.txt", "x");
        String id = com.jayway.jsonpath.JsonPath.read(json, "$.asset.id");

        mvc.perform(patch("/api/assets/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reviewStatus\":\"approved\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("invalid_review_transition"));
    }

    @Test
    @DisplayName("不存在的素材返回 404")
    void missingAssetReturns404() throws Exception {
        mvc.perform(get("/api/assets/asset_nope"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    @Test
    @DisplayName("文件夹建立后素材可归入，删除文件夹把素材移回根而不删除")
    void folderLifecycleKeepsAssets() throws Exception {
        String folderJson = mvc.perform(post("/api/asset-folders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"参考资料\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String folderId = com.jayway.jsonpath.JsonPath.read(folderJson, "$.id");

        MockMultipartFile file = new MockMultipartFile("file", "in-folder.txt", "text/plain",
                "x".getBytes(StandardCharsets.UTF_8));
        String created = mvc.perform(multipart("/api/assets").file(file).param("folderId", folderId))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String assetId = com.jayway.jsonpath.JsonPath.read(created, "$.asset.id");

        mvc.perform(delete("/api/asset-folders/" + folderId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.movedAssets").value(1));

        // 素材必须还在，只是回到根目录。
        mvc.perform(get("/api/assets/" + assetId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.folderId").doesNotExist());
    }

    @Test
    @DisplayName("同名文件夹返回 409")
    void duplicateFolderNameConflicts() throws Exception {
        String body = "{\"name\":\"重复\"}";
        mvc.perform(post("/api/asset-folders").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/asset-folders").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("folder_exists"));
    }

    @Test
    @DisplayName("文件响应带内容类型，支持按需取回")
    void contentResponseHasMediaType() throws Exception {
        String json = uploadText("typed.txt", "abc");
        String id = com.jayway.jsonpath.JsonPath.read(json, "$.asset.id");
        mvc.perform(get("/api/assets/" + id + "/content"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type",
                        org.hamcrest.Matchers.containsString("text/plain")));
    }
}
