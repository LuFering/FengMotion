package com.fengmotion.server.preset.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.preset.domain.PresetMapping;
import com.fengmotion.server.preset.domain.WorkflowPreset;
import com.fengmotion.server.preset.service.PresetMappingModel;
import com.fengmotion.server.preset.store.WorkflowPresetRepository;
import com.fengmotion.server.skill.client.GithubArchiveClient;
import com.fengmotion.server.skill.domain.SkillPackage;
import com.fengmotion.server.skill.service.SkillPackageService;

/** 映射生成、审阅、启用、归档。模型换成假实现。 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class WorkflowPresetApiTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired SkillPackageService skills;
    @Autowired WorkflowPresetRepository presets;
    @MockBean GithubArchiveClient github;
    @MockBean PresetMappingModel model;

    private JsonNode generate(SkillPackage pkg, String skillPath, HttpStatus expected) throws Exception {
        String body = mvc.perform(post("/api/skill-packages/{id}/mappings", pkg.id()).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(java.util.Map.of("skillPath", skillPath))))
                .andExpect(status().is(expected.value())).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return json.readTree(body);
    }

    @Test
    @DisplayName("生成映射：模型输出带代码块也能解析，校验通过存成草稿；truncatedSources 由后端填写")
    void generatesDraft() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        when(model.generate(anyString(), anyString()))
                .thenReturn("好的，映射如下：\n```json\n" + json.writeValueAsString(PresetFixtures.mapping("Logo 动画", "# 视觉构想")) + "\n```");

        JsonNode preset = generate(pkg, PresetFixtures.SKILL, HttpStatus.CREATED);
        assertEquals("draft", preset.path("status").asText());
        assertEquals(2, preset.path("mappingVersion").asInt());
        assertEquals("Logo 动画", preset.path("name").asText());
        assertEquals(pkg.commitSha(), preset.path("commitSha").asText());
        assertEquals(pkg.owner() + "/" + pkg.repo(), preset.path("sourceRepo").asText());
        assertEquals(0, preset.path("mapping").path("truncatedSources").size(), "模型给的 truncatedSources 不采信");

        ArgumentCaptor<String> system = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> prompt = ArgumentCaptor.forClass(String.class);
        verify(model).generate(system.capture(), prompt.capture());
        assertTrue(system.getValue().contains("待分析的数据"), "系统提示要声明资料不是指令");
        assertTrue(prompt.getValue().contains("<<<FILE " + PresetFixtures.SKILL + ">>>"));
        assertTrue(prompt.getValue().contains("- bash scripts/check.sh"), "要把清单里的命令交给模型逐条决定");
        String userMessage = prompt.getValue();
        assertTrue(userMessage.indexOf("生成一份工作流映射") >= 0
                && userMessage.indexOf("生成一份工作流映射") < userMessage.indexOf("<<<FILE "));
        String afterSources = userMessage.substring(userMessage.lastIndexOf("<<<END FILE>>>") + "<<<END FILE>>>".length());
        assertTrue(afterSources.contains("只输出一个 JSON 对象"));
        assertTrue(afterSources.contains("render → create") && afterSources.contains("deliver-approved → delivery"));
        assertTrue(afterSources.contains("requiredWhen"));
        for (String field : List.of("name", "slug", "guide", "sources", "reviewChecklist", "instructedCommands", "stepMapping")) {
            assertTrue(afterSources.contains('"' + field + '"'), field);
        }
    }

    @Test
    @DisplayName("模型编造文件或输出不是 JSON：422 附逐项问题，不保存")
    void rejectsInvalidModelOutput() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        PresetMapping good = PresetFixtures.mapping("编造", null);
        PresetMapping fabricated = new PresetMapping(good.name(), good.description(), good.slug(), good.promptScaffold(),
                good.defaults(), good.requiredInputs(), null, null, good.reviewChecklist(),
                List.of(new PresetMapping.GuideSection("t", "b", List.of("skills/logo/secret.md"))), good.components(),
                good.instructedCommands(), good.stepMapping(), null, null);
        when(model.generate(anyString(), anyString())).thenReturn(json.writeValueAsString(fabricated));

        JsonNode error = generate(pkg, PresetFixtures.SKILL, HttpStatus.UNPROCESSABLE_ENTITY);
        assertEquals("mapping_invalid", error.path("error").path("code").asText());
        assertEquals("guide[0].sources[0]", error.path("error").path("problems").path(0).path("field").asText());

        when(model.generate(anyString(), anyString())).thenReturn("抱歉，我无法完成");
        assertEquals("mapping_invalid", generate(pkg, PresetFixtures.SKILL, HttpStatus.UNPROCESSABLE_ENTITY)
                .path("error").path("code").asText());

        mvc.perform(get("/api/workflow-presets").param("status", "all")).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.skillPackageId == '" + pkg.id() + "')]").isEmpty());
    }

    @Test
    void rejectsWrongResponsibilitiesWithoutWritingOrOverwritingDrafts() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        ObjectNode mapping = json.valueToTree(PresetFixtures.mapping("图表制作", null));
        ObjectNode step = (ObjectNode) mapping.path("stepMapping").get(0);
        step.put("step", "生成最终排名图").put("action", "render").put("node", "delivery");
        when(model.generate(anyString(), anyString())).thenReturn(mapping.toString());
        assertEquals("stepMapping[0].node", generate(pkg, PresetFixtures.SKILL, HttpStatus.UNPROCESSABLE_ENTITY)
                .at("/error/problems/0/field").asText());
        assertTrue(presets.find(null).stream().noneMatch(preset -> pkg.id().equals(preset.skillPackageId())));

        step.put("node", "create");
        when(model.generate(anyString(), anyString())).thenReturn(mapping.toString());
        String id = generate(pkg, PresetFixtures.SKILL, HttpStatus.CREATED).path("id").asText();
        WorkflowPreset before = presets.findById(id).orElseThrow();
        step.remove("action");
        mvc.perform(put("/api/workflow-presets/{id}/mapping", id).contentType(MediaType.APPLICATION_JSON).content(mapping.toString()))
                .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.error.problems[0].field").value("stepMapping[0].action"));
        assertEquals(before, presets.findById(id).orElseThrow());
    }

    @Test
    void oldDraftIsNotRewrittenAndCanBeCorrectedBeforeActivation() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        ObjectNode mapping = json.valueToTree(PresetFixtures.mapping("原草稿", null));
        ObjectNode step = (ObjectNode) mapping.path("stepMapping").get(0);
        step.remove("action");
        step.put("step", "渲染成片 mp4 交付").put("node", "delivery");
        String id = UUID.randomUUID().toString();
        Instant now = Instant.now();
        presets.save(new WorkflowPreset(id, "原草稿", "旧数据", WorkflowPreset.DRAFT, pkg.id(), "acme/logo", PresetFixtures.SKILL,
                pkg.commitSha(), json.treeToValue(mapping, PresetMapping.class), 1, now, now, null));
        WorkflowPreset before = presets.findById(id).orElseThrow();
        mvc.perform(post("/api/workflow-presets/{id}/activate", id)).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.problems[0].field").value("stepMapping[0].step"));
        assertEquals(before, presets.findById(id).orElseThrow());
        step.put("step", "交付已审过的影片");
        mvc.perform(put("/api/workflow-presets/{id}/mapping", id).contentType(MediaType.APPLICATION_JSON).content(mapping.toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.mappingVersion").value(1));
        mvc.perform(post("/api/workflow-presets/{id}/activate", id)).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("active"));
    }

    @Test
    @DisplayName("SKILL.md 不在包里：400；模型不可用：503")
    void inputAndModelErrors() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        assertEquals("validation_error", generate(pkg, "skills/none/SKILL.md", HttpStatus.BAD_REQUEST).path("error").path("code").asText());

        when(model.generate(anyString(), anyString()))
                .thenThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "model_unavailable", "模型未接入"));
        assertEquals("model_unavailable", generate(pkg, PresetFixtures.SKILL, HttpStatus.SERVICE_UNAVAILABLE)
                .path("error").path("code").asText());
    }

    @Test
    @DisplayName("草稿可改、启用后只读；列表默认只给启用中的；归档后不再出现")
    void lifecycle() throws Exception {
        SkillPackage pkg = PresetFixtures.importLogoSkill(skills, github);
        when(model.generate(anyString(), anyString())).thenReturn(json.writeValueAsString(PresetFixtures.mapping("Logo 动画", null)));
        String id = generate(pkg, PresetFixtures.SKILL, HttpStatus.CREATED).path("id").asText();

        mvc.perform(put("/api/workflow-presets/{id}/mapping", id).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(PresetFixtures.mapping("Logo 开场动画", null))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Logo 开场动画"));
        PresetMapping invalid = new PresetMapping("x", "y", "BAD SLUG", "p", null, null, null, null, List.of("c"),
                PresetFixtures.mapping("x", null).guide(), null, PresetFixtures.mapping("x", null).instructedCommands(),
                PresetFixtures.mapping("x", null).stepMapping(), null, null);
        mvc.perform(put("/api/workflow-presets/{id}/mapping", id).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(invalid)))
                .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.error.problems[0].field").value("slug"));

        mvc.perform(get("/api/workflow-presets")).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')]").isEmpty());
        mvc.perform(post("/api/workflow-presets/{id}/activate", id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("active")).andExpect(jsonPath("$.activatedAt").isNotEmpty());
        mvc.perform(get("/api/workflow-presets")).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].name").value(org.hamcrest.Matchers.contains("Logo 开场动画")));

        mvc.perform(put("/api/workflow-presets/{id}/mapping", id).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(PresetFixtures.mapping("改名", null))))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("preset_not_editable"));

        mvc.perform(delete("/api/workflow-presets/{id}", id)).andExpect(status().isNoContent());
        mvc.perform(delete("/api/workflow-presets/{id}", id)).andExpect(status().isNoContent());
        mvc.perform(get("/api/workflow-presets")).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')]").isEmpty());
        mvc.perform(get("/api/workflow-presets/{id}", id)).andExpect(jsonPath("$.status").value("archived"));
        mvc.perform(post("/api/workflow-presets/{id}/activate", id)).andExpect(status().isConflict());
        mvc.perform(get("/api/workflow-presets").param("status", "bogus")).andExpect(status().isBadRequest());
    }
}
