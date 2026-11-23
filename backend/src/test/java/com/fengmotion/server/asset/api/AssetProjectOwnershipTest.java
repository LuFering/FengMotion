package com.fengmotion.server.asset.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.project.store.ProjectPurgeRepository;
import com.jayway.jsonpath.JsonPath;

/**
 * 素材归属项目（2026-11-23，契约 asset.md「归属项目」）。
 *
 * <p>归属与引用是两件事：归属只有一个，可改、可清空；删除项目时素材变回未归属，不随项目删除。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class AssetProjectOwnershipTest {

    private static final String PROJECT_A = "proj-own-a";
    private static final String PROJECT_B = "proj-own-b";
    private static final String ARCHIVED = "proj-own-archived";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ProjectPurgeRepository purge;

    @BeforeEach
    void projects() {
        insertProject(PROJECT_A, "项目甲", 0);
        insertProject(PROJECT_B, "项目乙", 0);
        insertProject(ARCHIVED, "已归档", 1);
    }

    private void insertProject(String id, String name, int archived) {
        String now = Instant.now().toString();
        jdbc.update("INSERT INTO projects (id, name, created_at, updated_at, etag, archived) VALUES (?, ?, ?, ?, ?, ?)",
                id, name, now, now, id, archived);
    }

    private String upload(String name, String body, String projectId) throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", name, "text/plain",
                body.getBytes(StandardCharsets.UTF_8));
        var request = multipart("/api/assets").file(file);
        if (projectId != null) {
            request.param("projectId", projectId);
        }
        String json = mvc.perform(request)
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(json, "$.asset.id");
    }

    @Test
    @DisplayName("上传带项目即归属该项目；列表可按项目与未归属筛选；facets 给出项目计数")
    void uploadIntoProjectAndFilter() throws Exception {
        String owned = upload("own-a.txt", "owned-by-a", PROJECT_A);
        String loose = upload("loose.txt", "no-project", null);

        mvc.perform(get("/api/assets/" + owned))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectId").value(PROJECT_A));
        mvc.perform(get("/api/assets/" + loose))
                .andExpect(jsonPath("$.projectId").doesNotExist());

        mvc.perform(get("/api/assets").param("projectId", PROJECT_A))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].id").value(owned));

        String unassignedJson = mvc.perform(get("/api/assets").param("projectId", "unassigned").param("limit", "200"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        java.util.List<String> unassignedIds = JsonPath.read(unassignedJson, "$.items[*].id");
        org.junit.jupiter.api.Assertions.assertTrue(unassignedIds.contains(loose));
        org.junit.jupiter.api.Assertions.assertFalse(unassignedIds.contains(owned));

        mvc.perform(get("/api/assets/facets"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projects." + PROJECT_A).value(1))
                .andExpect(jsonPath("$.unassigned").isNumber());
    }

    @Test
    @DisplayName("不存在或已归档的项目不能收素材：上传、PATCH、批量修改都返回 404")
    void rejectsMissingOrArchivedProject() throws Exception {
        MockMultipartFile file = new MockMultipartFile("file", "x.txt", "text/plain",
                "reject".getBytes(StandardCharsets.UTF_8));
        mvc.perform(multipart("/api/assets").file(file).param("projectId", "proj-missing"))
                .andExpect(status().isNotFound());

        String id = upload("y.txt", "reject-patch", null);
        mvc.perform(patch("/api/assets/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"projectId\":\"" + ARCHIVED + "\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/assets/batch-update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\"" + id + "\"],\"projectId\":\"proj-missing\"}"))
                .andExpect(status().isNotFound());

        mvc.perform(post("/api/assets/uploads")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"z.txt\",\"mimeType\":\"text/plain\",\"sizeBytes\":3,\"projectId\":\"proj-missing\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("PATCH 改别的字段不会清掉归属；projectId 空串改回未归属")
    void patchKeepsOrClearsProject() throws Exception {
        String id = upload("keep.txt", "keep-owner", PROJECT_A);

        mvc.perform(patch("/api/assets/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"改名后.txt\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("改名后.txt"))
                .andExpect(jsonPath("$.projectId").value(PROJECT_A));

        mvc.perform(patch("/api/assets/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"projectId\":\"" + PROJECT_B + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectId").value(PROJECT_B));

        mvc.perform(patch("/api/assets/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"projectId\":\"\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectId").doesNotExist());
    }

    @Test
    @DisplayName("批量移至项目；只加标签时归属不变；空串移回未归属")
    void batchMovesProject() throws Exception {
        String a = upload("b-a.txt", "batch-own-1", null);
        String b = upload("b-b.txt", "batch-own-2", null);

        mvc.perform(post("/api/assets/batch-update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\"" + a + "\",\"" + b + "\"],\"projectId\":\"" + PROJECT_A + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results[0].asset.projectId").value(PROJECT_A))
                .andExpect(jsonPath("$.results[1].asset.projectId").value(PROJECT_A));

        mvc.perform(post("/api/assets/batch-update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\"" + a + "\"],\"addTags\":[\"片头\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results[0].asset.projectId").value(PROJECT_A));

        mvc.perform(post("/api/assets/batch-update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\"" + b + "\"],\"projectId\":\"\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.results[0].asset.projectId").doesNotExist());
    }

    @Test
    @DisplayName("重复导入同一文件：未归属的补上项目，已归属别的项目的不被改走")
    void dedupeClaimsOnlyUnassigned() throws Exception {
        String loose = upload("same-1.txt", "dedupe-loose", null);
        String again = upload("same-1.txt", "dedupe-loose", PROJECT_A);
        org.junit.jupiter.api.Assertions.assertEquals(loose, again);
        mvc.perform(get("/api/assets/" + loose)).andExpect(jsonPath("$.projectId").value(PROJECT_A));

        String reimported = upload("same-1.txt", "dedupe-loose", PROJECT_B);
        org.junit.jupiter.api.Assertions.assertEquals(loose, reimported);
        mvc.perform(get("/api/assets/" + loose)).andExpect(jsonPath("$.projectId").value(PROJECT_A));
    }

    @Test
    @DisplayName("物理删除项目后，它的素材变回未归属而不是被删除")
    void purgeProjectUnassignsAssets() throws Exception {
        String id = upload("purge.txt", "purge-owner", PROJECT_B);

        purge.deleteProjectGraph(PROJECT_B);

        mvc.perform(get("/api/assets/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectId").doesNotExist());
    }
}
