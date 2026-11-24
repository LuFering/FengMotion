package com.fengmotion.server.creation.service;

import com.fengmotion.server.creation.store.CreationTaskStore;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.store.CreationStateStore;
import com.fengmotion.server.creation.domain.CreationSessionAccess;
import com.fengmotion.server.creation.domain.CreateRequest;
import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.render.service.ProjectFilmRenderer;
import com.fengmotion.server.workflow.service.WorkflowProjectService;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.domain.ShotTimeline;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

import lombok.extern.slf4j.Slf4j;

/**
 * 编排项目源码创作、状态、幂等与工程渲染生命周期。
 */
@Slf4j
@Service
public class ProjectCreationService {

    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final CreateAgentRunner agent;
    private final ResourceContextBuilder resourceContexts;
    private final CreationStateStore creationStates;
    private final CreationTaskStore creationTasks;
    private final CreationSessionAccess sessionAccess;

    private final ProjectOperationLock operations;
    private final ProjectFilmRenderService filmRenders;
    private final WorkflowProjectService workflowProject;
    private final SourceTargetService sourceTargets;
    private final SourceDraftService sourceDrafts;

    @org.springframework.beans.factory.annotation.Autowired
    public ProjectCreationService(
            ProjectRepository projects,
            ProjectSceneRepository scenes,
            CreateAgentRunner agent,
            ResourceContextBuilder resourceContexts,
            CreationStateStore creationStates,
            CreationTaskStore creationTasks,
            CreationSessionAccess sessionAccess,
            ProjectOperationLock operations,
            ProjectFilmRenderService filmRenders,
            WorkflowProjectService workflowProject,
            SourceTargetService sourceTargets,
            SourceDraftService sourceDrafts) {
        this.projects = projects;
        this.scenes = scenes;
        this.agent = agent;
        this.resourceContexts = resourceContexts;
        this.creationStates = creationStates;
        this.creationTasks = creationTasks;
        this.sessionAccess = sessionAccess;
        this.operations = operations;
        this.filmRenders = filmRenders;
        this.workflowProject = workflowProject;
        this.sourceTargets = sourceTargets;
        this.sourceDrafts = sourceDrafts;
    }

    public ProjectCreationService(ProjectRepository projects, ProjectSceneRepository scenes, CreateAgentRunner agent,
            ResourceContextBuilder resourceContexts, CreationStateStore creationStates, CreationTaskStore creationTasks,
            CreationSessionAccess sessionAccess, ProjectOperationLock operations, ProjectFilmRenderService filmRenders,
            WorkflowProjectService workflowProject, SourceTargetService sourceTargets) {
        this(projects, scenes, agent, resourceContexts, creationStates, creationTasks, sessionAccess, operations,
                filmRenders, workflowProject, sourceTargets, new SourceDraftService(new ProjectSourceSnapshots()));
    }

    public ProjectCreationService(ProjectRepository projects, ProjectSceneRepository scenes, CreateAgentRunner agent,
            ResourceContextBuilder resourceContexts, CreationStateStore creationStates, CreationTaskStore creationTasks,
            CreationSessionAccess sessionAccess, ProjectOperationLock operations, ProjectFilmRenderService filmRenders,
            WorkflowProjectService workflowProject) {
        this(projects, scenes, agent, resourceContexts, creationStates, creationTasks, sessionAccess, operations,
                filmRenders, workflowProject, null);
    }

    public ProjectCreationService(
            com.fengmotion.server.project.store.ProjectRepository projects,
            com.fengmotion.server.project.store.ProjectSceneRepository scenes,
            ProjectFilmConfig configs,
            ProjectFilmRenderer filmRenderer,
            CreateAgentRunner agent,
            ResourceContextBuilder resourceContexts,
            ObjectMapper json,
            CreationStateStore creationStates,
            ProjectOperationLock operations,
            ProjectSourceSnapshots sourceSnapshots,
            WorkflowProjectService workflowProject) {
        this(projects, scenes, agent, resourceContexts, creationStates, null, null, operations,
                new ProjectFilmRenderService(projects, scenes, configs, filmRenderer,
                        json, creationStates, sourceSnapshots), workflowProject);
    }

    /**
     * 渲染项目工程并提交为新版本。
     *
     * @param projectId 项目 ID
     * @param prompt    触发这次渲染的用户要求；可为 null
     * @return 结果
     */
    public RenderOutcome render(String projectId, String prompt) {
        operations.acquire(projectId);
        try {
            RenderOutcome outcome = renderUnlocked(projectId, prompt);
            try {
                Path root = Path.of(projects.findById(projectId).orElseThrow().rootPath()).toAbsolutePath().normalize();
                var previous = creationStates.read(root);
                creationStates.write(root, creationStates.state(CreateOutcome.RENDERED, prompt,
                        "已重新渲染当前工程。", previous == null ? null : previous.references(),
                        outcome.artifactPath(), outcome.version(), null));
            } catch (RuntimeException statusFailure) {
                log.warn("渲染已提交，但状态保存失败：{}", projectId, statusFailure);
            }
            return outcome;
        } finally {
            operations.release(projectId);
        }
    }

    private RenderOutcome renderUnlocked(String projectId, String prompt) {
        return renderUnlocked(projectId, prompt, false);
    }

    private RenderOutcome renderUnlocked(String projectId, String prompt, boolean shotTimeline) {
        ProjectFilmRenderService.RenderResult result = shotTimeline
                ? filmRenders.render(projectId, prompt, true) : filmRenders.render(projectId, prompt);
        return new RenderOutcome(result.artifactPath(), result.version(), result.entry(),
                result.compositionId(), result.result(), result.renderMs());
    }

    private RenderOutcome renderCreation(String projectId,String prompt,boolean shotTimeline,String requestId) {
        var result=filmRenders.renderCreation(projectId,prompt,shotTimeline,requestId);
        return new RenderOutcome(result.artifactPath(),result.version(),result.entry(),result.compositionId(),result.result(),result.renderMs());
    }

    public Optional<CreateOutcome> recoverRenderResult(String projectId,String requestId) {
        if(requestId==null || requestId.isBlank()) return Optional.empty();
        return scenes.findVersionByCreationRequest(projectId,requestId).map(version->{
            String reply="已恢复此前完成的成片 v"+version.version();
            if(creationTasks!=null) {
                var task=creationTasks.findByRequestId(requestId).orElse(null);
                if(task!=null && task.reply()!=null) reply=task.reply();
                creationTasks.updateCompleted(requestId,CreateOutcome.RENDERED,"completed",reply,version.artifactPath(),version.version(),task!=null && task.sessionSaved());
            }
            return new CreateOutcome(CreateOutcome.RENDERED,reply,0,version.artifactPath(),version.version(),null,List.of());
        });
    }

    /**
     * 让 agent 改工程，然后渲染出新版本。
     *
     * <p>这是「用户提要求 → AI 改画面 → 看到新片子」的完整一步。
     * 顺序不能反：先让 agent 改源码，再渲染 —— 反过来渲的是旧代码。</p>
     *
     * <p><strong>agent 改完但没出片要如实报</strong>：它可能只解释了思路没动文件，
     * 也可能改了却没写对 film.config.json。这时不能当成成功，
     * 否则用户会以为「已经改好了」，其实画面上什么都没变。</p>
     *
     * @param projectId 项目 ID
     * @param intent    这一轮要做什么；null 表示按现有需求与纠正推进
     * @return 结果
     */
    public CreateOutcome createThenRender(String projectId, String intent, JsonNode references) {
        return createThenRender(projectId, intent, references, null);
    }

    public CreateOutcome createThenRender(String projectId, String intent, JsonNode references, String previewImage) {
        return createThenRender(projectId, intent, references, previewImage, null);
    }

    public CreateOutcome createThenRender(String projectId, String intent, JsonNode references, String previewImage, Long expectedVersion) {
        return createThenRender(projectId, intent, references, previewImage, expectedVersion, null);
    }

    public CreateOutcome createThenRender(String projectId, String intent, JsonNode references, String previewImage, Long expectedVersion, String correction) {
        return createThenRender(projectId, intent, references, previewImage, expectedVersion, correction, null);
    }

    public CreateOutcome createThenRender(String projectId, String intent, JsonNode references, String previewImage, Long expectedVersion, String correction, String requestId) {
        return createThenRender(projectId, intent, references, previewImage, expectedVersion, correction, requestId, null, null);
    }

    public CreateOutcome createThenRender(String projectId, String intent, JsonNode references, String previewImage, Long expectedVersion, String correction, String requestId, String sessionId, String userMessageId) {
        return createThenRender(projectId, intent, references, previewImage, expectedVersion, correction, requestId, sessionId, userMessageId, null);
    }

    public CreateOutcome createThenRender(String projectId, String intent, JsonNode references, String previewImage, Long expectedVersion,
            String correction, String requestId, String sessionId, String userMessageId,
            com.fengmotion.server.harness.client.NativeHarnesses.Selection selection) {
        return createThenRender(projectId, intent, references, previewImage, expectedVersion, correction,
                requestId, sessionId, userMessageId, selection, false);
    }

    CreateOutcome createShotFilm(String projectId, CreateRequest request) {
        return createThenRender(projectId, request.intent(), request.references(), request.previewImage(),
                request.baseVersion(), request.correction(), request.requestId(), request.sessionId(),
                request.userMessageId(), request.engineSelection(), true);
    }

    public CreateOutcome createDraft(String projectId, CreateRequest request) {
        request.validateOutputMode();
        return createThenRender(projectId, request.intent(), request.references(), request.previewImage(),
                request.baseVersion(), request.correction(), request.requestId(), request.sessionId(),
                request.userMessageId(), request.engineSelection(), false, request);
    }

    private long currentVersion(String projectId) {
        var current = scenes.find(projectId).orElse(null);
        if (current != null && !current.present()) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,
                "scene_corrupt", "当前场景记录损坏，未启动模型，请核对历史版本");
        return current == null ? 0 : current.version();
    }

    public void validateDraftRequest(String projectId, CreateRequest request) {
        request.validateOutputMode();
        if (!request.draftOnly() || request.sourceHash() == null) return;
        long actualVersion = currentVersion(projectId);
        if (request.baseVersion() != actualVersion) throw new ApiException(HttpStatus.CONFLICT, "version_conflict", "项目版本已变化，请重新选择目标");
        var project = projects.findById(projectId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        Path root = com.fengmotion.server.project.service.ProjectWorktreeService.root(project);
        if (!request.sourceHash().equals(com.fengmotion.server.project.service.ProjectWorktreeService.fingerprint(root))) {
            throw new ApiException(HttpStatus.CONFLICT, "source_changed", "工作稿已变化，请重新读取目标后提交");
        }
        if (request.target() != null) sourceTargets.validate(root, request.target());
    }

    private CreateOutcome createThenRender(String projectId, String intent, JsonNode references, String previewImage, Long expectedVersion,
            String correction, String requestId, String sessionId, String userMessageId,
            com.fengmotion.server.harness.client.NativeHarnesses.Selection selection, boolean shotTimeline) {
        return createThenRender(projectId, intent, references, previewImage, expectedVersion, correction,
                requestId, sessionId, userMessageId, selection, shotTimeline, null);
    }

    private CreateOutcome createThenRender(String projectId, String intent, JsonNode references, String previewImage, Long expectedVersion,
            String correction, String requestId, String sessionId, String userMessageId,
            com.fengmotion.server.harness.client.NativeHarnesses.Selection selection, boolean shotTimeline, CreateRequest draftRequest) {
        boolean draftOnly = draftRequest != null;
        if (selection != null) agent.validateSelection(selection);
        operations.acquire(projectId);
        try {
            if (requestId != null && !requestId.isBlank()) {
                String requestHash = computeFingerprint(projectId, intent, references, previewImage, expectedVersion, correction);
                if (shotTimeline) requestHash += "|film=" + ShotTimeline.FORMAT;
                if (draftOnly) requestHash += "|output=draft";
                if (draftOnly) requestHash += "|source=" + draftRequest.sourceHash() + "|target=" + draftRequest.target();
                if (selection != null) requestHash += "|engine=" + selection.harness() + "|model=" + selection.model() + "|effort=" + selection.reasoningEffort();
                var existingTask = creationTasks.findByRequestId(requestId);
                if (existingTask.isPresent()) {
                    var task = existingTask.get();
                    if (!requestHash.equals(task.requestHash())) {
                        throw new ApiException(HttpStatus.CONFLICT, "task_idempotency_conflict",
                                "请求 ID 已用于不同创作任务");
                    }
                    if(!draftOnly) {
                        var recovered=recoverRenderResult(projectId,requestId);
                        if(recovered.isPresent()) return recovered.get();
                    }
                    if (CreateOutcome.EDITED.equals(task.status()) || CreateOutcome.RENDERED.equals(task.status()) || CreateOutcome.AWAITING_INFO.equals(task.status())) {
                        log.info("创作请求 requestId={} 此前已完成，命中服务端任务幂等，直接返回已有结果", requestId);
                        return new CreateOutcome(task.status(), task.reply(), 0L,
                                task.artifactPath(), task.version(), null, List.of());
                    }
                    if ("running".equalsIgnoreCase(task.status())) {
                        log.warn("创作请求 requestId={} 仍处于 running 状态但此前执行未正常收尾，重置为中断失败状态", requestId);
                        creationTasks.updateFailed(requestId, "任务执行异常中断，请重新提交");
                        return new CreateOutcome("failed", "任务执行异常中断，请重新提交", 0L,
                                task.artifactPath(), task.version(), null, List.of());
                    }
                    if ("failed".equalsIgnoreCase(task.status())) {
                        log.warn("创作请求 requestId={} 此前已执行失败，直接返回失败状态", requestId);
                        return new CreateOutcome("failed", task.errorMessage() != null ? task.errorMessage() : task.reply(), 0L,
                                task.artifactPath(), task.version(), null, List.of());
                    }
                } else {
                    try {
                        creationTasks.insert(requestId, projectId, sessionId, userMessageId, requestHash,
                                "running", "analyzing", intent);
                    } catch (Exception ex) {
                        var raceCheck = creationTasks.findByRequestId(requestId);
                        if (raceCheck.isPresent()) {
                            var raceTask = raceCheck.get();
                            if (!requestHash.equals(raceTask.requestHash())) {
                                throw new ApiException(HttpStatus.CONFLICT, "task_idempotency_conflict",
                                        "请求 ID 已用于不同创作任务");
                            }
                            if ("running".equalsIgnoreCase(raceTask.status())) {
                                throw new ApiException(HttpStatus.CONFLICT, "task_already_running",
                                        "该创作任务正在执行中，请勿重复提交");
                            }
                            if (CreateOutcome.EDITED.equals(raceTask.status()) || CreateOutcome.RENDERED.equals(raceTask.status()) || CreateOutcome.AWAITING_INFO.equals(raceTask.status())) {
                                return new CreateOutcome(raceTask.status(), raceTask.reply(), 0L,
                                        raceTask.artifactPath(), raceTask.version(), null, List.of());
                            }
                        }
                        log.error("无法登记创作任务，中止执行以防止幂等失效：requestId={} ex={}", requestId, ex.getMessage());
                        throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "task_registration_failed",
                                "无法登记创作任务，中止执行以确保幂等保护: " + ex.getMessage());
                    }
                }
            }
            try {
                long actualVersion = currentVersion(projectId);
                if (expectedVersion != null || shotTimeline) {
                    if (expectedVersion != null && actualVersion != expectedVersion) {
                        throw new ApiException(HttpStatus.CONFLICT, "version_conflict", "项目版本已变化，请刷新预览并重新选择修改目标。");
                    }
                    if (shotTimeline && actualVersion != 0) {
                        throw new ApiException(HttpStatus.CONFLICT, "shot_film_requires_new_project", "镜头装配试点只用于尚未出片的项目");
                    }
                }
                if (previewImage != null) CreateAgentRunner.previewImages(previewImage);
                if (draftOnly) validateDraftRequest(projectId, draftRequest);
                if (correction != null && !correction.isBlank()) workflowProject.recordCorrection(projectId, correction, requestId);
                return createUnlocked(projectId, intent, references, previewImage, requestId, sessionId, userMessageId, selection, shotTimeline, draftRequest);
            } catch (RuntimeException failure) {
                if (requestId != null && !requestId.isBlank() && !com.fengmotion.server.project.service.SceneCommitVerifier.uncertain(failure)) {
                    creationTasks.updateFailed(requestId, failure.getMessage());
                }
                throw failure;
            }
        } finally {
            operations.release(projectId);
        }
    }

    public static String computeFingerprint(String projectId, String intent, JsonNode references,
                                            String previewImage, Long baseVersion, String correction) {
        try {
            java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
            digest.update(projectId.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            digest.update((byte) 0);
            if (intent != null) digest.update(intent.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            digest.update((byte) 0);
            if (references != null) digest.update(references.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            digest.update((byte) 0);
            if (previewImage != null) digest.update(previewImage.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            digest.update((byte) 0);
            if (baseVersion != null) digest.update(baseVersion.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            digest.update((byte) 0);
            if (correction != null) digest.update(correction.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public boolean syncTaskReplyToSession(CreationTaskStore.Record task) {
        if (task == null || task.sessionId() == null || task.reply() == null || task.reply().isBlank()) {
            return false;
        }
        if ("failed".equals(task.status())) {
            // 失败任务的错误信息仅作为报错提示，严禁作为 AI 助手创作回复写入会话历史
            return false;
        }
        boolean ok = recordAssistantReplyToSession(task.sessionId(), task.userMessageId(), task.requestId(), task.reply());
        if (ok) {
            creationTasks.updateSessionSaved(task.requestId(), true);
        }
        return ok;
    }

    private boolean recordAssistantReplyToSession(String sessionId, String userMessageId, String requestId, String reply) {
        if (sessionId == null || sessionId.isBlank() || reply == null || reply.isBlank()) {
            return false;
        }
        try {
            sessionAccess.saveReply(sessionId, userMessageId, requestId, reply);
            log.info("已自动将创作助手回复持久化到服务端会话：sessionId={}, taskId={}", sessionId, userMessageId);
            return true;
        } catch (Exception ex) {
            log.warn("自动落盘创作助手回复到会话失败（非致命）：{}", ex.getMessage());
            return false;
        }
    }

    /** 运行中状态只对本进程有效，重启遗留的运行记录应告诉用户本轮已中断。 */
    public CreationStateStore.State creationState(String projectId) {
        Project project = projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        if (project.rootPath() == null) return null;
        var state = creationStates.read(Path.of(project.rootPath()).toAbsolutePath().normalize());
        if (state != null && "running".equals(state.state()) && !operations.isBusy(projectId)) {
            return creationStates.state("interrupted", state.intent(), state.reply(), state.references(),
                    state.artifactPath(), state.version(), "上次创作已中断，请检查工程后继续或重新渲染", state.requestId(), "interrupted");
        }
        return state;
    }

    private CreateOutcome createUnlocked(String projectId, String intent, JsonNode references, String previewImage) {
        return createUnlocked(projectId, intent, references, previewImage, null, null, null);
    }

    private CreateOutcome createUnlocked(String projectId, String intent, JsonNode references, String previewImage, String requestId) {
        return createUnlocked(projectId, intent, references, previewImage, requestId, null, null);
    }

    private CreateOutcome createUnlocked(String projectId, String intent, JsonNode references, String previewImage, String requestId, String sessionId, String userMessageId) {
        return createUnlocked(projectId, intent, references, previewImage, requestId, sessionId, userMessageId, null);
    }
    private CreateOutcome createUnlocked(String projectId, String intent, JsonNode references, String previewImage, String requestId,
            String sessionId, String userMessageId, com.fengmotion.server.harness.client.NativeHarnesses.Selection selection) {
        return createUnlocked(projectId, intent, references, previewImage, requestId, sessionId, userMessageId, selection, false);
    }

    private CreateOutcome createUnlocked(String projectId, String intent, JsonNode references, String previewImage, String requestId,
            String sessionId, String userMessageId, com.fengmotion.server.harness.client.NativeHarnesses.Selection selection, boolean shotTimeline) {
        return createUnlocked(projectId, intent, references, previewImage, requestId, sessionId, userMessageId,
                selection, shotTimeline, null);
    }

    private CreateOutcome createUnlocked(String projectId, String intent, JsonNode references, String previewImage, String requestId,
            String sessionId, String userMessageId, com.fengmotion.server.harness.client.NativeHarnesses.Selection selection,
            boolean shotTimeline, CreateRequest draftRequest) {
        boolean draftOnly = draftRequest != null;
        Project project = projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        String rootPath = project.rootPath();
        if (rootPath == null || rootPath.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目还没有目录");
        }
        Path root = Path.of(rootPath).toAbsolutePath().normalize();

        /* 资源必须先解析成 agent 能读懂的描述再交出去。
           直接把 ID 列表丢给 agent，它无从知道用户到底想「用进画面」还是「只借鉴」；
           查不到也要在这里报错，不能跳过 —— 用户会以为资源已经用上了。 */
        var previous = creationStates.read(root);
        // Continuation is scoped to its originating session, never the last job of another conversation.
        var previousTask=previous==null||previous.requestId()==null?null:creationTasks.findByRequestId(previous.requestId()).orElse(null);
        boolean sameSession=previousTask!=null && java.util.Objects.equals(sessionId,previousTask.sessionId());
        JsonNode effectiveRefs = references == null || references.isNull()
                ? previous == null || !sameSession ? null : previous.references() : references;
        var resources = resourceContexts.build(effectiveRefs);
        String instruction = intent;
        if (previous != null && sameSession && CreateOutcome.AWAITING_INFO.equals(previous.state())) {
            instruction = "上一轮用户要求：\n" + previous.intent()
                    + "\nAgent 上一轮的说明/问题：\n" + previous.reply()
                    + "\n用户本轮补充：\n" + (intent == null ? "按已有要求继续" : intent);
        }
        if (draftOnly) instruction = (instruction == null ? "按已有要求修改工程" : instruction)
                + "\n\n本轮仅修改工作稿。不要执行渲染、出片或登记版本；保存源码后说明改动，用户将通过实时预览审阅并显式出片。";
        creationStates.write(root, creationStates.state("running", intent, null, effectiveRefs, null, null, null, requestId, "analyzing"));
        if (requestId != null && !requestId.isBlank()) {
            creationTasks.updatePhase(requestId, "analyzing");
        }
        String reply = null;
        try {
            var sourceRequest = draftOnly ? draftRequest : new CreateRequest(intent, references, previewImage,
                    null, null, requestId, sessionId, userMessageId, selection == null ? null : selection.harness(),
                    selection == null ? null : selection.model(), selection == null ? null : selection.reasoningEffort());
            var agentResult = draftOnly && draftRequest.target() != null
                    ? sourceTargets.run(root, draftRequest, instruction, resources, agent, projectId)
                    : sourceDrafts.run(root, sourceRequest, instruction, resources, agent, projectId, shotTimeline);
            reply = agentResult.reply();
            // 新项目尚无入口也能正常追问；先判断是否改动，再校验可渲染性。
            if (!agentResult.changed()) {
                boolean saved = recordAssistantReplyToSession(sessionId, userMessageId, requestId, reply);
                creationStates.write(root, creationStates.state(CreateOutcome.AWAITING_INFO,
                        intent, reply, effectiveRefs, null, null, null, requestId, "awaiting_info", saved));
                if (requestId != null && !requestId.isBlank()) {
                    creationTasks.updateCompleted(requestId, CreateOutcome.AWAITING_INFO, "awaiting_info", reply, null, null, saved);
                }
                return CreateOutcome.awaitingInfo(reply, agentResult.elapsedMs(), resources.resolved());
            }

            if (draftOnly) {
                boolean saved = recordAssistantReplyToSession(sessionId, userMessageId, requestId, reply);
                creationStates.write(root, creationStates.state(CreateOutcome.EDITED, intent, reply,
                        effectiveRefs, null, null, null, requestId, "edited", saved));
                if (requestId != null && !requestId.isBlank()) {
                    creationTasks.updateCompleted(requestId, CreateOutcome.EDITED, "edited", reply, null, null, saved);
                }
                return new CreateOutcome(CreateOutcome.EDITED, reply, agentResult.elapsedMs(),
                        null, null, null, resources.resolved());
            }

            creationStates.write(root, creationStates.state("running", intent, reply, effectiveRefs, null, null, null, requestId, "rendering"));
            if (requestId != null && !requestId.isBlank()) {
                creationTasks.updatePhase(requestId, "rendering");
            }

            if (!shotTimeline) filmRenders.validateConfig(root);
            RenderOutcome rendered = renderCreation(projectId, intent, shotTimeline,requestId);
            boolean saved = recordAssistantReplyToSession(sessionId, userMessageId, requestId, reply);
            try {
                creationStates.write(root, creationStates.state(CreateOutcome.RENDERED, intent, reply,
                        effectiveRefs, rendered.artifactPath(), rendered.version(), null, requestId, "completed", saved));
            } catch (RuntimeException statusFailure) {
                log.warn("视频版本已提交，但创作状态保存失败：{}", projectId, statusFailure);
            }
            if (requestId != null && !requestId.isBlank()) {
                creationTasks.updateCompleted(requestId, CreateOutcome.RENDERED, "completed", reply, rendered.artifactPath(), rendered.version(), saved);
            }

            return new CreateOutcome(CreateOutcome.RENDERED, reply, agentResult.elapsedMs(),
                    rendered.artifactPath(), rendered.version(), rendered.result(), resources.resolved());
        } catch (RuntimeException failure) {
            if(!draftOnly) {
                try {
                    var recovered=recoverRenderResult(projectId,requestId);
                    if(recovered.isPresent()) return recovered.get();
                } catch(RuntimeException lookupFailure) {
                    failure.addSuppressed(lookupFailure);
                }
            }
            if(com.fengmotion.server.project.service.SceneCommitVerifier.uncertain(failure)) throw failure;
            try {
                creationStates.write(root, creationStates.state("failed", intent, reply, effectiveRefs,
                        null, null, failure.getMessage(), requestId, "failed"));
            } catch (RuntimeException statusFailure) {
                failure.addSuppressed(statusFailure);
            }
            if (requestId != null && !requestId.isBlank()) {
                creationTasks.updateFailed(requestId, failure.getMessage());
            }
            throw failure;
        }
    }

    /**
     * agent 改工程 + 渲染的结果。
     *
     * @param state       结果状态：{@code rendered} 有新片；{@code awaiting_info} agent 在等用户补充信息
     * @param reply       agent 的说明
     * @param agentMs     agent 耗时
     * @param artifactPath 产物路径（未渲染时为 null）
     * @param version     版本号（未渲染时为 null）
     * @param render      渲染规格（未渲染时为 null）
     * @param resources   本轮用到的三库资源
     */
    public record CreateOutcome(String state, String reply, long agentMs, String artifactPath,
                                Long version, ProjectFilmRenderer.Result render,
                                java.util.List<ResourceContextBuilder.ResolvedResource> resources) {

        /** 已出新片。 */
        public static final String RENDERED = "rendered";
        public static final String EDITED = "edited";

        /** agent 没有改动工程，通常在等用户补充信息。 */
        public static final String AWAITING_INFO = "awaiting_info";

        /** 本轮没有渲染：版本与产物都为空，前端据此显示「等待补充」而不是播放器。 */
        public static CreateOutcome awaitingInfo(String reply, long agentMs,
                java.util.List<ResourceContextBuilder.ResolvedResource> resources) {
            return new CreateOutcome(AWAITING_INFO, reply, agentMs, null, null, null, resources);
        }
    }

    /**
     * 列出项目里参与渲染的源码文件（供界面显示「这一版改了哪些文件」）。
     *
     * @param projectId 项目 ID
     * @return 相对路径列表
     */
    public List<String> sourceFiles(String projectId) {
        Project project = projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        if (project.rootPath() == null) return List.of();
        Path root = Path.of(project.rootPath()).toAbsolutePath().normalize();
        return filmRenders.sourceFiles(root);
    }

    /**
     * 渲染结果。
     *
     * @param artifactPath   产物相对路径
     * @param version        提交的版本号
     * @param entry          使用的入口
     * @param compositionId  使用的 composition
     * @param result         渲染规格
     * @param renderMs       耗时毫秒
     */
    public record RenderOutcome(String artifactPath, long version, String entry,
                                String compositionId, ProjectFilmRenderer.Result result,
                                long renderMs) {
    }
}
