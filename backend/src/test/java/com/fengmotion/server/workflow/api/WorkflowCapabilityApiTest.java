package com.fengmotion.server.workflow.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.fengmotion.server.common.ApiExceptionHandler;
import com.fengmotion.server.harness.domain.HarnessDescriptor;
import com.fengmotion.server.harness.service.HarnessService;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.workflow.service.WorkflowNodeCapabilities;
import com.fengmotion.server.workflow.service.WorkflowNodeCapabilities.NodeCapability;

/** 节点执行能力（契约 workflow-editor-ui.md §4）。项目库与引擎探测换成假实现。 */
class WorkflowCapabilityApiTest {

    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final HarnessService harnesses = mock(HarnessService.class);
    private final WorkflowNodeCapabilities service = new WorkflowNodeCapabilities(projects, harnesses);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new WorkflowCapabilityController(service))
                .setControllerAdvice(new ApiExceptionHandler()).build();
        when(projects.findById("p1")).thenReturn(Optional.of(new Project("p1", "项目", null, null, "/tmp/p1", Instant.now())));
        when(projects.findById("gone")).thenReturn(Optional.empty());
    }

    private static HarnessDescriptor engine(String id, HarnessDescriptor.Status status) {
        return new HarnessDescriptor(id, id, "cli", status, null, null, null);
    }

    private static Map<String, NodeCapability> byType(List<NodeCapability> list) {
        return list.stream().collect(Collectors.toMap(NodeCapability::nodeType, c -> c));
    }

    @Test
    @DisplayName("关联项目且有可用引擎：与契约 §4.3 一致，全部可运行，reason 为 null")
    void linkedProject() {
        when(harnesses.listDescriptors()).thenReturn(List.of(
                engine("dsh-sdk", HarnessDescriptor.Status.UNAVAILABLE), engine("codex", HarnessDescriptor.Status.AVAILABLE)));
        List<NodeCapability> list = service.list("p1", "prompt-first");
        assertEquals(List.of("prompt", "refs", "capability", "create", "review", "delivery"),
                list.stream().map(NodeCapability::nodeType).toList());
        Map<String, String> execution = list.stream().collect(Collectors.toMap(NodeCapability::nodeType, NodeCapability::execution));
        assertEquals(Map.of("prompt", "resolve", "refs", "resolve", "capability", "resolve",
                "create", "agent", "review", "manual", "delivery", "deterministic"), execution);
        assertTrue(list.stream().allMatch(c -> c.available() && c.reason() == null));
    }

    @Test
    @DisplayName("关联项目但没有可用引擎：只有「制作与渲染」不能运行，并说明原因")
    void noEngine() {
        when(harnesses.listDescriptors()).thenReturn(List.of(
                engine("dsh-sdk", HarnessDescriptor.Status.MISCONFIGURED), engine("claude", HarnessDescriptor.Status.UNAVAILABLE)));
        Map<String, NodeCapability> caps = byType(service.list("p1", "prompt-first"));
        assertFalse(caps.get("create").available());
        assertEquals("agent", caps.get("create").execution());
        assertFalse(caps.get("create").reason().isBlank());
        assertTrue(caps.values().stream().filter(c -> !c.nodeType().equals("create")).allMatch(NodeCapability::available));
    }

    @Test
    @DisplayName("未关联项目：全部是演示并带一句说明，不探测引擎；关联的项目已删除：全部不能运行")
    void unlinkedAndMissingProject() {
        for (String projectId : new String[] {null, "", "  "}) {
            List<NodeCapability> demo = service.list(projectId, "prompt-first");
            assertEquals(6, demo.size());
            assertTrue(demo.stream().allMatch(c -> c.execution().equals("demo") && c.available() && c.reason() != null));
        }
        List<NodeCapability> missing = service.list("gone", "prompt-first");
        assertTrue(missing.stream().allMatch(c -> !c.available() && c.reason() != null));
        assertEquals("agent", byType(missing).get("create").execution(), "执行方式仍按关联项目时标注");
        verify(harnesses, never()).listDescriptors();
    }

    @Test
    @DisplayName("分阶段评估：产物与检查点都是 manual，与是否关联项目无关")
    void structured() {
        for (String projectId : new String[] {null, "p1", "gone"}) {
            List<NodeCapability> list = service.list(projectId, "structured");
            assertEquals(List.of("artifact", "gate"), list.stream().map(NodeCapability::nodeType).toList());
            assertTrue(list.stream().allMatch(c -> c.execution().equals("manual") && c.available() && c.reason() == null));
        }
    }

    @Test
    @DisplayName("接口：字段名与契约一致；path 缺失或取值不对为 400 validation_error")
    void endpoint() throws Exception {
        mvc.perform(get("/api/workflow/node-capabilities").param("path", "prompt-first"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].nodeType").value("prompt"))
                .andExpect(jsonPath("$[0].execution").value("demo"))
                .andExpect(jsonPath("$[0].available").value(true))
                .andExpect(jsonPath("$[0].reason").isString());
        mvc.perform(get("/api/workflow/node-capabilities").param("projectId", "p1").param("path", "structured"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[1].nodeType").value("gate"))
                .andExpect(jsonPath("$[1].reason").doesNotExist());
        mvc.perform(get("/api/workflow/node-capabilities").param("path", "linear"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("validation_error"));
        mvc.perform(get("/api/workflow/node-capabilities"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("validation_error"));
    }
}
