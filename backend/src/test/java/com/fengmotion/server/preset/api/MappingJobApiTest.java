package com.fengmotion.server.preset.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.preset.domain.PresetMapping;
import com.fengmotion.server.preset.service.PresetMappingModel;
import com.fengmotion.server.preset.store.WorkflowPresetRepository;
import com.fengmotion.server.skill.client.GithubArchiveClient;
import com.fengmotion.server.skill.domain.SkillPackage;
import com.fengmotion.server.skill.service.SkillPackageService;

/**
 * 生成预设草稿的后台作业（契约 workflow-editor-ui.md §2）。模型换成假实现。
 *
 * <p>不加 {@code @Transactional}：作业在后台线程里执行，测试事务不提交的话后台线程既看不到导入的包，
 * 也会被 SQLite 的写锁挡住。每个用例用随机仓库名导入新包，互不影响。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MappingJobApiTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired SkillPackageService skills;
    @Autowired WorkflowPresetRepository presets;
    @MockBean GithubArchiveClient github;
    @MockBean PresetMappingModel model;

    private JsonNode call(MockHttpServletRequestBuilder request, HttpStatus expected) throws Exception {
        String body = mvc.perform(request).andExpect(status().is(expected.value()))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return body.isEmpty() ? null : json.readTree(body);
    }

    private JsonNode submit(SkillPackage pkg, Object body, HttpStatus expected) throws Exception {
        return call(post("/api/skill-packages/{id}/mapping-jobs", pkg.id()).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body)), expected);
    }

    private JsonNode job(String id) throws Exception {
        return call(get("/api/mapping-jobs/{id}", id), HttpStatus.OK);
    }

    /** 按前端的方式轮询，直到作业满足条件。 */
    private JsonNode await(String id, java.util.function.Predicate<JsonNode> done) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        JsonNode current = job(id);
        while (!done.test(current)) {
            JsonNode seen = current;
            assertTrue(System.nanoTime() < deadline, () -> "作业没有按预期推进：" + seen);
            Thread.sleep(30);
            current = job(id);
        }
        return current;
    }

    private static boolean terminal(JsonNode job) {
        return List.of("succeeded", "failed", "cancelled").contains(job.path("status").asText());
    }

    private boolean hasPresetFor(SkillPackage pkg) {
        return presets.find(null).stream().anyMatch(preset -> pkg.id().equals(preset.skillPackageId()));
    }

    @Test
    @DisplayName("成功：202 返回作业，结束后带草稿 ID 与交给模型的上下文，阶段与开始时间清空")
    void succeedsAndReportsContext() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        when(model.available()).thenReturn(true);
        when(model.generate(anyString(), anyString()))
                .thenReturn(json.writeValueAsString(PresetFixtures.mapping("Logo 动画", null)));

        JsonNode created = submit(pkg, Map.of("skillPath", PresetFixtures.SKILL), HttpStatus.ACCEPTED);
        assertEquals(pkg.id(), created.path("skillPackageId").asText());
        assertEquals(PresetFixtures.SKILL, created.path("skillPath").asText());
        assertTrue(List.of("queued", "running", "succeeded").contains(created.path("status").asText()));
        for (String field : List.of("stage", "stageStartedAt", "startedAt", "finishedAt", "context", "presetId", "error")) {
            assertTrue(created.has(field), () -> "作业必须带字段 " + field + "（可以为 null）");
        }

        JsonNode done = await(created.path("id").asText(), MappingJobApiTest::terminal);
        assertEquals("succeeded", done.path("status").asText());
        assertTrue(done.path("stage").isNull() && done.path("stageStartedAt").isNull(), "终态时阶段为 null");
        assertTrue(done.path("error").isNull());
        Instant started = Instant.parse(done.path("startedAt").asText());
        assertFalse(Instant.parse(done.path("finishedAt").asText()).isBefore(started), "时间是 ISO 8601，结束不早于开始");
        assertTrue(done.path("context").path("files").asInt() >= 1);
        assertTrue(done.path("context").path("chars").asInt() > 0);
        assertTrue(done.path("context").path("truncatedSources").isArray());

        String presetId = done.path("presetId").asText();
        assertEquals("draft", presets.findById(presetId).orElseThrow().status());
        assertEquals(0, call(get("/api/skill-packages/{id}/mapping-jobs", pkg.id()).param("active", "true"), HttpStatus.OK).size(),
                "结束的作业不在未结束列表里");
        assertEquals(1, call(get("/api/skill-packages/{id}/mapping-jobs", pkg.id()), HttpStatus.OK).size());
    }

    @Test
    @DisplayName("校验不通过：作业以 failed 结束，error 带 mapping_invalid 与字段路径，不保存草稿")
    void failsWithProblemsWithoutSaving() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        PresetMapping good = PresetFixtures.mapping("编造", null);
        PresetMapping fabricated = new PresetMapping(good.name(), good.description(), good.slug(), good.promptScaffold(),
                good.defaults(), good.requiredInputs(), null, null, good.reviewChecklist(),
                List.of(new PresetMapping.GuideSection("t", "b", List.of("skills/logo/secret.md"))), good.components(),
                good.instructedCommands(), good.stepMapping(), null, null);
        when(model.available()).thenReturn(true);
        when(model.generate(anyString(), anyString())).thenReturn(json.writeValueAsString(fabricated));

        JsonNode done = await(submit(pkg, Map.of("skillPath", PresetFixtures.SKILL), HttpStatus.ACCEPTED).path("id").asText(),
                MappingJobApiTest::terminal);
        assertEquals("failed", done.path("status").asText());
        assertEquals("mapping_invalid", done.at("/error/code").asText());
        assertEquals("guide[0].sources[0]", done.at("/error/problems/0/field").asText());
        assertTrue(done.path("presetId").isNull());
        assertTrue(done.path("context").path("files").asInt() >= 1, "收集阶段的结果保留，便于界面说明交给了模型什么");
        assertFalse(hasPresetFor(pkg));
    }

    @Test
    @DisplayName("模型调用中：重复提交 409 并给出作业 ID，可接回；取消后以 cancelled 结束且不保存草稿")
    void conflictsReattachesAndCancels() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        String output = json.writeValueAsString(PresetFixtures.mapping("Logo 动画", null));
        when(model.available()).thenReturn(true);
        when(model.generate(anyString(), anyString())).thenAnswer(invocation -> {
            entered.countDown();
            try {
                release.await(10, TimeUnit.SECONDS);
            } catch (InterruptedException interrupted) {
                // 与 DshPresetMappingModel 相同：保留中断标记，转成业务异常
                Thread.currentThread().interrupt();
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "model_unavailable", "模型调用被中断");
            }
            return output;
        });

        String id = submit(pkg, Map.of("skillPath", PresetFixtures.SKILL), HttpStatus.ACCEPTED).path("id").asText();
        assertTrue(entered.await(10, TimeUnit.SECONDS));
        JsonNode running = await(id, job -> "calling_model".equals(job.path("stage").asText()));
        assertEquals("running", running.path("status").asText());
        assertFalse(running.path("stageStartedAt").isNull(), "界面据此显示已用时间");

        JsonNode conflict = submit(pkg, Map.of("skillPath", PresetFixtures.SKILL), HttpStatus.CONFLICT);
        assertEquals("mapping_in_progress", conflict.at("/error/code").asText());
        assertEquals(id, conflict.at("/error/details/jobId").asText());
        JsonNode active = call(get("/api/skill-packages/{id}/mapping-jobs", pkg.id()).param("active", "true"), HttpStatus.OK);
        assertEquals(1, active.size());
        assertEquals(id, active.path(0).path("id").asText());

        call(post("/api/mapping-jobs/{id}/cancel", id), HttpStatus.OK);
        JsonNode cancelled = await(id, MappingJobApiTest::terminal);
        assertEquals("cancelled", cancelled.path("status").asText());
        assertTrue(cancelled.path("error").isNull() && cancelled.path("presetId").isNull());
        assertFalse(hasPresetFor(pkg));

        JsonNode again = call(post("/api/mapping-jobs/{id}/cancel", id), HttpStatus.OK);
        assertEquals(cancelled, again, "终态时原样返回当前作业");
    }

    @Test
    @DisplayName("错误：缺 skillPath / 包里没有这个 SKILL.md 为 400，包或作业不存在为 404，模型未接入为 503 且不建作业")
    void rejectsInvalidRequests() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        when(model.available()).thenReturn(true);

        assertEquals("validation_error", submit(pkg, Map.of(), HttpStatus.BAD_REQUEST).at("/error/code").asText());
        assertEquals("validation_error", submit(pkg, Map.of("skillPath", "skills/none/SKILL.md"), HttpStatus.BAD_REQUEST)
                .at("/error/code").asText());
        assertEquals("not_found", call(post("/api/skill-packages/{id}/mapping-jobs", "missing").contentType(MediaType.APPLICATION_JSON)
                .content("{\"skillPath\":\"SKILL.md\"}"), HttpStatus.NOT_FOUND).at("/error/code").asText());
        assertEquals("not_found", call(get("/api/mapping-jobs/{id}", "missing"), HttpStatus.NOT_FOUND).at("/error/code").asText());
        assertEquals("not_found", call(post("/api/mapping-jobs/{id}/cancel", "missing"), HttpStatus.NOT_FOUND).at("/error/code").asText());
        assertEquals("not_found", call(get("/api/skill-packages/{id}/mapping-jobs", "missing").param("active", "true"),
                HttpStatus.NOT_FOUND).at("/error/code").asText());

        when(model.available()).thenReturn(false);
        assertEquals("model_unavailable", submit(pkg, Map.of("skillPath", PresetFixtures.SKILL), HttpStatus.SERVICE_UNAVAILABLE)
                .at("/error/code").asText());
        assertEquals(0, call(get("/api/skill-packages/{id}/mapping-jobs", pkg.id()), HttpStatus.OK).size(), "作业不创建");
    }
}
