package com.fengmotion.server.workflow.service;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.harness.domain.HarnessDescriptor;
import com.fengmotion.server.harness.service.HarnessService;
import com.fengmotion.server.project.store.ProjectRepository;

import lombok.RequiredArgsConstructor;

/**
 * 节点执行能力（契约 workflow-editor-ui.md §4）：同一个节点在不同条件下做的事不同，
 * 界面上的节点标签、检查器和运行按钮都从这里取，不在前端各写一套判断。
 *
 * <p>规则与契约 §4.3 的表一致，另外按后端能看到的事实补两条：
 * 关联的项目已不存在时节点都不能运行；本机没有任何可用的 Agent 引擎时「制作与渲染」不能运行。</p>
 *
 * <p>只返回契约表里列出的节点类型；旧版节点（lookdev / filmplan / finishing）和泳道不在其中，
 * 前端按「还没有接入真实执行」处理。</p>
 */
@Service
@RequiredArgsConstructor
public class WorkflowNodeCapabilities {

    public static final String PROMPT_FIRST = "prompt-first";
    public static final String STRUCTURED = "structured";

    /** 调用 Agent 制作或渲染，会写项目文件。 */
    public static final String AGENT = "agent";
    /** 读取并解析资料，不写项目内容。 */
    public static final String RESOLVE = "resolve";
    /** 结论来自用户在检查器里的选择。 */
    public static final String MANUAL = "manual";
    /** 按规则判定，不调用模型。 */
    public static final String DETERMINISTIC = "deterministic";
    /** 只产生界面快照，不读写项目。 */
    public static final String DEMO = "demo";

    /** prompt-first 路径关联项目时各节点的执行方式，顺序与 workflowTemplates.ts 一致。 */
    private static final List<String[]> PROMPT_FIRST_NODES = List.of(
            new String[] {"prompt", RESOLVE},
            new String[] {"refs", RESOLVE},
            new String[] {"capability", RESOLVE},
            new String[] {"create", AGENT},
            new String[] {"review", MANUAL},
            new String[] {"delivery", DETERMINISTIC});

    /** structured 路径只评估阶段产物与检查点，不制作视频。 */
    private static final List<String> STRUCTURED_NODES = List.of("artifact", "gate");

    static final String UNLINKED_REASON = "没有关联项目，运行只产生界面快照，不读写任何项目";
    static final String PROJECT_MISSING_REASON = "关联的项目已不存在，重新关联项目后才能运行";
    static final String NO_ENGINE_REASON = "没有可用的 Agent 引擎，接入引擎后才能真实制作";

    private final ProjectRepository projects;
    private final HarnessService harnesses;

    /**
     * 一个节点在当前条件下的执行能力。
     *
     * @param nodeType  与 workflowTemplates.ts 的节点类型一致
     * @param execution agent / resolve / manual / deterministic / demo
     * @param available false 表示这个条件下不能运行该节点
     * @param reason    available=false 或 execution=demo 时给用户看的一句话，其余为 null
     */
    public record NodeCapability(String nodeType, String execution, boolean available, String reason) {
    }

    /**
     * @param projectId 关联的项目；为空表示没有关联
     * @param path      prompt-first 或 structured
     * @throws ApiException path 取值不对（400 validation_error）
     */
    public List<NodeCapability> list(String projectId, String path) {
        if (STRUCTURED.equals(path)) {
            return STRUCTURED_NODES.stream().map(type -> new NodeCapability(type, MANUAL, true, null)).toList();
        }
        if (!PROMPT_FIRST.equals(path)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "path 只能是 prompt-first 或 structured");
        }

        if (projectId == null || projectId.isBlank()) {
            return PROMPT_FIRST_NODES.stream()
                    .map(node -> new NodeCapability(node[0], DEMO, true, UNLINKED_REASON)).toList();
        }
        if (projects.findById(projectId.strip()).isEmpty()) {
            return PROMPT_FIRST_NODES.stream()
                    .map(node -> new NodeCapability(node[0], node[1], false, PROJECT_MISSING_REASON)).toList();
        }
        boolean engineReady = anyEngineAvailable();
        return PROMPT_FIRST_NODES.stream().map(node -> AGENT.equals(node[1]) && !engineReady
                ? new NodeCapability(node[0], node[1], false, NO_ENGINE_REASON)
                : new NodeCapability(node[0], node[1], true, null)).toList();
    }

    /** 制作时用户可以选任一引擎，所以只要有一个可用就算能运行；探测结果由 HarnessService 缓存。 */
    private boolean anyEngineAvailable() {
        return harnesses.listDescriptors().stream()
                .anyMatch(descriptor -> descriptor.status() == HarnessDescriptor.Status.AVAILABLE);
    }
}
