package com.fengmotion.server.creation.service;

import java.nio.file.Path;

import org.springframework.stereotype.Service;

import com.fengmotion.server.creation.domain.CreateRequest;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.service.SourceEditSession;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class SourceDraftService {
    private final ProjectSourceSnapshots snapshots;

    public CreateAgentRunner.AgentOutcome run(Path root, CreateRequest request, String instruction,
            ResourceContextBuilder.ResourceContext resources, CreateAgentRunner agent, String projectId) {
        return run(root, request, instruction, resources, agent, projectId, false);
    }

    public CreateAgentRunner.AgentOutcome run(Path root, CreateRequest request, String instruction,
            ResourceContextBuilder.ResourceContext resources, CreateAgentRunner agent, String projectId, boolean shotTimeline) {
        try (var workspace = SourceEditSession.open(snapshots,root,request.sourceHash())) {
            String scopedInstruction = instruction
                            + "\n本轮在独立工作稿副本中执行。允许写入 src/、public/、components/、scenes/、styles/、assets/ 及根目录源码/样式/JSON配置；"
                            + "其他工程资料作为上下文读取，不会写回。不要操作原项目绝对路径。";
            var outcome = shotTimeline
                    ? agent.runShotFilm(workspace.path(), scopedInstruction, resources, request.previewImage(), projectId, request.sessionId(), request.requestId(), request.engineSelection())
                    : agent.run(workspace.path(), scopedInstruction, resources, request.previewImage(), projectId, request.sessionId(), request.requestId(), request.engineSelection());
            requireRunning();
            String hash=workspace.apply(()-> { requireRunning();return false; });
            boolean changed=!workspace.beforeHash().equals(hash);
            return new CreateAgentRunner.AgentOutcome(outcome.reply(), outcome.elapsedMs(), outcome.hasEntry(),
                    outcome.hasConfig(), changed, workspace.beforeHash(), hash);
        }
    }

    private static void requireRunning() {
        CreationCancellation.requireRunning();
    }
}
