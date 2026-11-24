package com.fengmotion.server.skill.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.skill.client.GithubArchiveClient;
import com.fengmotion.server.skill.service.SkillPackageService;
import com.fengmotion.server.skill.service.TestZips;

/** 导入前预检（契约 workflow-editor-ui.md §3）：只解析 commit，不下载、不落盘、不登记。 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class SkillPackageResolveApiTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired SkillPackageService skills;
    @MockBean GithubArchiveClient github;
    @Value("${fengmotion.skill-packages.root}") String root;

    private static String sha() {
        return UUID.randomUUID().toString().replace("-", "") + "00000000";
    }

    private JsonNode resolve(Map<String, String> params, HttpStatus expected) throws Exception {
        var request = get("/api/skill-packages/resolve");
        params.forEach(request::param);
        return json.readTree(mvc.perform(request).andExpect(status().is(expected.value()))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    private long packageDirectories() throws Exception {
        Path dir = Path.of(root);
        if (!Files.isDirectory(dir)) return 0;
        try (Stream<Path> entries = Files.list(dir)) {
            return entries.count();
        }
    }

    @Test
    @DisplayName("地址带 /tree/<ref>/<path>：owner/repo 小写，给出 commit 与子目录，未导入时 existingPackageId 为 null，不下载")
    void resolvesWithoutDownloading() throws Exception {
        String repo = "Repo-" + UUID.randomUUID().toString().substring(0, 8);
        String lower = repo.toLowerCase();
        String sha = sha();
        when(github.resolveCommit("acme", lower, "main")).thenReturn(sha);
        long before = packageDirectories();

        JsonNode result = resolve(Map.of("repository", "https://github.com/Acme/" + repo + "/tree/main/skills/logo"), HttpStatus.OK);
        assertEquals("acme", result.path("owner").asText());
        assertEquals(lower, result.path("repo").asText());
        assertEquals("main", result.path("ref").asText());
        assertEquals(sha, result.path("commitSha").asText());
        assertEquals("skills/logo", result.path("subPath").asText());
        assertTrue(result.has("existingPackageId") && result.path("existingPackageId").isNull());

        verify(github, never()).openZip(anyString(), anyString(), anyString());
        assertEquals(before, packageDirectories(), "预检不落盘");
        assertTrue(skills.list().stream().noneMatch(pkg -> pkg.repo().equals(lower)), "预检不计入导入登记");
    }

    @Test
    @DisplayName("默认分支 ref 为 null；同一 owner/repo/commit/子目录已导入时给出包 ID")
    void reportsExistingPackage() throws Exception {
        String repo = "repo-" + UUID.randomUUID().toString().substring(0, 8);
        String sha = sha();
        byte[] zip = TestZips.github(Map.of("SKILL.md", "---\nname: logo\ndescription: d\n---\n"));
        when(github.resolveCommit(eq("acme"), eq(repo), isNull())).thenReturn(sha);
        when(github.openZip(any(), eq(repo), eq(sha))).thenAnswer(invocation -> new ByteArrayInputStream(zip));
        String id = skills.importPackage("acme/" + repo, null, null).skillPackage().id();

        JsonNode result = resolve(Map.of("repository", "acme/" + repo), HttpStatus.OK);
        assertTrue(result.path("ref").isNull(), "null 表示默认分支");
        assertEquals("", result.path("subPath").asText());
        assertEquals(id, result.path("existingPackageId").asText());

        when(github.resolveCommit("acme", repo, "dev")).thenReturn(sha);
        assertTrue(resolve(Map.of("repository", "acme/" + repo, "ref", "dev", "path", "other"), HttpStatus.OK)
                .path("existingPackageId").isNull(), "子目录不同不算已导入");
    }

    @Test
    @DisplayName("错误码与导入相同：地址不合法 400，仓库不存在 404，GitHub 不可用 502")
    void usesImportErrorCodes() throws Exception {
        assertEquals("validation_error", resolve(Map.of(), HttpStatus.BAD_REQUEST).at("/error/code").asText());
        assertEquals("validation_error", resolve(Map.of("repository", "https://gitlab.com/a/b"), HttpStatus.BAD_REQUEST)
                .at("/error/code").asText());

        when(github.resolveCommit("acme", "gone", null))
                .thenThrow(new ApiException(HttpStatus.NOT_FOUND, "not_found", "仓库或 ref 不存在"));
        assertEquals("not_found", resolve(Map.of("repository", "acme/gone"), HttpStatus.NOT_FOUND).at("/error/code").asText());

        when(github.resolveCommit("acme", "limited", null))
                .thenThrow(new ApiException(HttpStatus.BAD_GATEWAY, "upstream_unavailable", "GitHub 限流"));
        assertEquals("upstream_unavailable", resolve(Map.of("repository", "acme/limited"), HttpStatus.BAD_GATEWAY)
                .at("/error/code").asText());
    }
}
