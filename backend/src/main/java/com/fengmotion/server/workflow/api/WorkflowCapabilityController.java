package com.fengmotion.server.workflow.api;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.workflow.service.WorkflowNodeCapabilities;

import lombok.RequiredArgsConstructor;

/** 工作流节点执行能力（契约 workflow-editor-ui.md §4），不属于任何项目，所以不挂在 /projects 下。 */
@RestController
@RequestMapping("/api/workflow")
@RequiredArgsConstructor
public class WorkflowCapabilityController {
    private final WorkflowNodeCapabilities capabilities;

    @GetMapping("/node-capabilities")
    public List<WorkflowNodeCapabilities.NodeCapability> nodeCapabilities(
            @RequestParam(required = false) String projectId,
            @RequestParam(required = false) String path) {
        return capabilities.list(projectId, path);
    }
}
