package com.fengmotion.server.workflow.api;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.workflow.service.WorkflowProjectService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/projects/{projectId}/workflow")
@RequiredArgsConstructor
public class WorkflowProjectController {
    private final WorkflowProjectService service;

    @GetMapping
    public StateResponse state(@PathVariable String projectId) {
        return StateResponse.of(service.state(projectId));
    }

    @PostMapping("/init")
    public InitResponse init(@PathVariable String projectId, @RequestBody(required = false) InitRequest request) {
        var outcome = service.init(projectId, request == null ? null : request.prompt());
        return new InitResponse(StateResponse.of(outcome.state()), outcome.result().name(), outcome.note());
    }

    @PostMapping("/corrections")
    public StateResponse correction(@PathVariable String projectId, @RequestBody CorrectionRequest request) {
        return StateResponse.of(service.recordCorrection(projectId, request.text()));
    }

    public record InitRequest(String prompt) {}
    public record CorrectionRequest(String text) {}
    public record InitResponse(StateResponse state, String result, String note) {}

    public record StateResponse(String projectId, String directory, boolean initialized,
                                boolean toolAvailable, List<String> files,
                                long promptLength, int renderedPasses,
                                int failedPasses, int inProgressPasses,
                                String originalIntegrity, List<String> originalIntegrityReasons) {
        static StateResponse of(WorkflowProjectService.WorkflowProjectState state) {
            return new StateResponse(state.projectId(), state.directory(), state.initialized(),
                    state.toolAvailable(), state.files(), state.promptLength(),
                    state.renderedPasses(), state.failedPasses(), state.inProgressPasses(),
                    state.originalIntegrity(), state.originalIntegrityReasons());
        }
    }
}
