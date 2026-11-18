package com.fengmotion.server.workflow.api;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fengmotion.server.workflow.service.ProjectFilmConfig;
import com.fengmotion.server.workflow.service.ProjectRenderService;
import com.fengmotion.server.workflow.service.WorkflowProjectService;

import lombok.RequiredArgsConstructor;

/**
 * 项目 × workflow-v0.1.1 的衔接端点。
 *
 * <p>只暴露两件事：读上下文状态、建立上下文（把用户原文落盘）。
 * 创作本身仍由 workflow-v0.1.1 的创作指令驱动，这里不代劳 ——
 * 接口少是刻意的，避免又长出一条与工作流并行的简化管线。</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/workflow")
@RequiredArgsConstructor
public class WorkflowProjectController {

    private final WorkflowProjectService service;
    private final ProjectRenderService projectRender;
    private final ProjectFilmConfig filmConfig;
    private final com.fengmotion.server.workflow.service.CreationJobs jobs;
    private final com.fengmotion.server.workflow.service.CreationTaskStore creationTasks;
    private final com.fengmotion.server.workflow.service.CreationProgressStore creationProgress;

    @GetMapping("/creation-progress")
    public com.fengmotion.server.workflow.service.CreationProgressStore.Snapshot creationProgress(
            @PathVariable String projectId, @RequestParam String sessionId) {
        var progress = creationProgress.get(projectId, sessionId);
        return progress == null ? new com.fengmotion.server.workflow.service.CreationProgressStore.Snapshot(null, "") : progress;
    }

    /**
     * 读取项目的 workflow 创作上下文状态。
     *
     * @param projectId 项目 ID
     * @return 状态
     */
    @GetMapping
    public StateResponse state(@PathVariable String projectId) {
        var state = service.state(projectId);
        return StateResponse.of(state);
    }

    /**
     * 建立 Prompt-first 创作上下文。
     *
     * <p>把用户原始需求<strong>逐字</strong>写入 {@code prompt.original.md}。
     * 已存在时不覆盖 —— 原文一旦被后来的摘要替换，创作依据就没了。</p>
     *
     * @param projectId 项目 ID
     * @param request   请求体
     * @return 建立后的状态
     */
    @PostMapping("/init")
    public InitResponse init(@PathVariable String projectId,
                             @RequestBody(required = false) InitRequest request) {
        String prompt = request == null ? null : request.prompt();
        var outcome = service.init(projectId, prompt);
        var state = outcome.state();
        return new InitResponse(
                StateResponse.of(state),
                outcome.result().name(),
                outcome.note());
    }

    /**
     * 建立上下文的结果。
     *
     * <p>带上 {@code result} 与可选的 {@code note}：用户需要知道这次到底是
     * 「建好了」「没变化」还是「原文已存在、你的要求被记成了纠正」。
     * 只说「已就绪」会让人以为自己说的每句话都成了创作依据。</p>
     *
     * @param state  建立后的状态
     * @param result CREATED / UNCHANGED / RECORDED_AS_CORRECTION
     * @param note   补充说明；无则为 null
     */
    public record InitResponse(StateResponse state, String result, String note) {
    }

    /**
     * 让 agent 改工程并渲染出新版本。
     *
     * <p>一步完成「用户提要求 → AI 改画面 → 看到新片子」。
     * 这是创作链的主入口：agent 读原文与纠正改源码，后端负责渲染与登记版本。</p>
     *
     * @param projectId 项目 ID
     * @param request   可选的本轮意图
     * @return 结果
     */
    @GetMapping("/creation")
    public com.fengmotion.server.workflow.service.CreationStateStore.State creation(
            @PathVariable String projectId,
            @RequestParam(required = false) String requestId) {
        var state = projectRender.creationState(projectId);
        if (requestId != null && !requestId.isBlank()) {
            if (state != null && requestId.equals(state.requestId())) {
                /* 主路径也补上 userMessageId：状态文件里没有这个字段，
                   但任务表有 —— 刷新恢复要靠它把结论挂回正确的消息。 */
                return withUserMessageId(state, requestId);
            }
            var task = creationTasks.findByRequestId(requestId);
            if (task.isPresent()) {
                var t = task.get();
                if (!projectId.equals(t.projectId())) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "创作任务不属于该项目: " + requestId);
                }
                return new com.fengmotion.server.workflow.service.CreationStateStore.State(
                        t.status(), t.intent(), t.reply(), null, t.artifactPath(),
                        t.version(), t.errorMessage(), t.updatedAt().toString(),
                        t.requestId(), t.phase(), t.sessionSaved(), t.userMessageId(), t.sessionId()
                );
            }
            try {
                var job=jobs.get(projectId,requestId);
                String phase=job.phase();String status="accepted".equals(job.state())?"running":job.state();
                var result=job.result();
                return new com.fengmotion.server.workflow.service.CreationStateStore.State(status,null,result==null?null:result.path("reply").asText(null),null,result==null?null:result.path("artifactPath").asText(null),result==null||!result.hasNonNull("version")?null:result.path("version").asLong(),job.error(),java.time.Instant.now().toString(),requestId,phase,null,job.userMessageId(),job.sessionId());
            } catch(com.fengmotion.server.common.ApiException e) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND,"未找到指定创作任务");
            }
        }
        /* 无 requestId 参数：返回最近一次状态，同样补 userMessageId */
        return state == null ? null : withUserMessageId(state, state.requestId());
    }

    /**
     * 按 <strong>项目 + 会话</strong> 列出该会话真实发生过的创作轮次。
     *
     * <p>刷新恢复不能只读「项目最近一次状态」：那个查询不带会话，
     * 最近一次任务可能属于会话 B，却被写进当时打开的会话 A 的作用域。
     * 恢复必须按会话查、并且带着任务自己的 <code>sessionId</code> 回来，
     * 由前端核对「项目、会话、消息」三者都对得上才写。</p>
     *
     * <p>只返回能确定归属的记录：<code>user_message_id</code> 为空的旧任务
     * 一律不返回 —— 没有身份就没有归属，前端也就该降级不显示。</p>
     *
     * @param projectId 项目 ID
     * @param sessionId 会话 ID
     * @return 该会话的创作轮次（按时间正序，便于逐条回填）
     */
    @GetMapping("/creation-rounds")
    public List<CreationRoundDto> creationRounds(@PathVariable String projectId,
                                                 @RequestParam String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "缺少会话 ID");
        }
        return creationTasks.findByProjectAndSession(projectId, sessionId).stream()
                .filter(t -> t.userMessageId() != null && !t.userMessageId().isBlank())
                .map(t -> new CreationRoundDto(t.requestId(), t.projectId(), t.sessionId(),
                        t.userMessageId(), t.status(), t.reply(), t.version(),
                        t.errorMessage(), t.createdAt().toString(), t.updatedAt().toString()))
                .toList();
    }

    /**
     * 一条创作轮次。
     *
     * @param requestId     创作请求 ID
     * @param projectId     所属项目 —— 前端要与当前项目核对
     * @param sessionId     所属会话 —— 前端要与当前会话核对，绝不拿当前界面会话顶替
     * @param userMessageId 触发这一轮的用户消息 ID —— 唯一可靠的归属依据
     * @param status        轮次状态（rendered / awaiting_info / failed ...）
     * @param reply         agent 说明
     * @param version       产出版本；未渲染为 null
     * @param error         失败原因
     * @param createdAt     创建时间
     * @param updatedAt     更新时间
     */
    public record CreationRoundDto(String requestId, String projectId, String sessionId,
                                   String userMessageId, String status, String reply,
                                   Long version, String error, String createdAt, String updatedAt) {
    }

    /**
     * 给状态快照补上触发它的用户消息 ID。
     *
     * <p>状态文件（creation.json）不记这个字段，但任务表记了。
     * 刷新后前端需要它把「本轮未改动工程」挂回正确的消息 ——
     * 没有就只能降级不显示。查不到就原样返回（不猜）。</p>
     */
    private com.fengmotion.server.workflow.service.CreationStateStore.State withUserMessageId(
            com.fengmotion.server.workflow.service.CreationStateStore.State state, String requestId) {
        if (state == null || state.userMessageId() != null) return state;
        if (requestId == null || requestId.isBlank()) return state;
        return creationTasks.findByRequestId(requestId)
                .map(t -> new com.fengmotion.server.workflow.service.CreationStateStore.State(
                        state.state(), state.intent(), state.reply(), state.references(),
                        state.artifactPath(), state.version(), state.error(), state.updatedAt(),
                        state.requestId(), state.phase(), state.sessionSaved(), t.userMessageId(), t.sessionId()))
                .orElse(state);
    }

    @GetMapping("/unsaved-replies")
    public List<UnsavedReplyDto> unsavedReplies(
            @PathVariable String projectId,
            @RequestParam(required = false) String sessionId) {
        return creationTasks.findUnsavedByProjectId(projectId, sessionId).stream()
                .map(t -> new UnsavedReplyDto(t.requestId(), t.sessionId(), t.userMessageId(), t.reply(), t.createdAt().toString()))
                .toList();
    }

    public record UnsavedReplyDto(String requestId, String sessionId, String userMessageId, String reply, String createdAt) {}

    @PostMapping("/creation/{requestId}/sync-reply")
    public Map<String, Object> syncReplyToSession(
            @PathVariable String projectId,
            @PathVariable String requestId) {
        var taskOpt = creationTasks.findByRequestId(requestId);
        if(taskOpt.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND,"未找到指定创作任务");
        var task = taskOpt.get();
        if (!projectId.equals(task.projectId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "创作任务不属于该项目: " + requestId);
        }
        if (task.sessionId() == null || task.sessionId().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "该创作任务未关联会话");
        }
        boolean ok = projectRender.syncTaskReplyToSession(task);
        return Map.of("success", ok, "sessionSaved", ok);
    }

    @PostMapping("/create")
    public CreateResponse create(@PathVariable String projectId,
                                 @RequestBody(required = false) CreateRequest request) {
        String intent = request == null ? null : request.intent();
        var references = request == null ? null : request.references();
        var outcome = projectRender.createThenRender(
                projectId, intent, references,
                request == null ? null : request.previewImage(),
                request == null ? null : request.baseVersion(),
                request == null ? null : request.correction(),
                request == null ? null : request.requestId(),
                request == null ? null : request.sessionId(),
                request == null ? null : request.userMessageId(),
                request == null ? null : request.engineSelection()
        );
        /* 未渲染时没有 render 结果，尺寸/帧数一律给 0，而不是编一个默认规格 ——
           前端看 state 就知道该显示「等待补充信息」还是播放器。 */
        var render = outcome.render();
        return new CreateResponse(outcome.state(), outcome.reply(), outcome.agentMs(),
                outcome.artifactPath(), outcome.version(),
                render == null ? 0 : render.durationInFrames(),
                render == null ? 0 : render.width(),
                render == null ? 0 : render.height(),
                render == null ? 0 : render.fps(),
                outcome.resources().stream()
                        .map(r -> new UsedResource(r.kind(), r.id(), r.label(), r.usage(),
                                r.path(), r.startMs(), r.endMs()))
                        .toList(),
                /* 回显本次请求身份：前端据此把结果挂到「实际发起修改的那条消息」上，
                   而不是靠「最后一条 AI 回复」推断归属。 */
                request == null ? null : request.requestId(),
                request == null ? null : request.userMessageId());
    }

    @GetMapping("/preview-image-capability")
    public java.util.Map<String, Boolean> previewImageCapability() {
        return java.util.Map.of("supported", true, "baseVersionCheck", true, "atomicCorrection", true, "correctionRetryId", true);
    }

    /**
     * 创作请求。
     *
     * @param intent 这一轮要做什么；省略则按现有需求与纠正推进
     */
    public record CreateRequest(String intent,
                                com.fasterxml.jackson.databind.JsonNode references,
                                String previewImage,
                                Long baseVersion,
                                String correction,
                                String requestId,
                                String sessionId,
                                String userMessageId, String harness, String model, String reasoningEffort, com.fasterxml.jackson.databind.JsonNode workflow) {
        public CreateRequest(String intent,com.fasterxml.jackson.databind.JsonNode references,String previewImage,Long baseVersion,String correction,String requestId,String sessionId,String userMessageId,String harness,String model,String reasoningEffort){this(intent,references,previewImage,baseVersion,correction,requestId,sessionId,userMessageId,harness,model,reasoningEffort,null);}
        public com.fengmotion.server.harness.client.NativeHarnesses.Selection engineSelection() {
            return harness == null && model == null && reasoningEffort == null ? null
                : new com.fengmotion.server.harness.client.NativeHarnesses.Selection(harness, model, reasoningEffort);
        }
    }

    /**
     * 这次创作实际用到的资源。
     *
     * <p>返回它是为了让界面与日志能核对「用户选的资源有没有真的传下去」——
     * 消息里保存了引用不等于 agent 用上了，必须能看到解析结果。</p>
     *
     * @param kind    类型
     * @param id      资源 ID
     * @param label   名称
     * @param usage   用途
     * @param path    文件路径（素材）
     * @param startMs 起始毫秒（参考片）
     * @param endMs   结束毫秒（参考片）
     */
    public record UsedResource(String kind, String id, String label, String usage,
                               String path, Long startMs, Long endMs) {
    }

    /**
     * 创作结果。
     *
     * @param state            {@code rendered} 有新片；{@code awaiting_info} agent 只提问未改工程
     * @param reply            agent 说明
     * @param agentMs          agent 耗时
     * @param artifactPath     产物路径；未渲染时为 null
     * @param version          版本号；未渲染时为 null
     * @param durationInFrames 时长帧数；未渲染时为 0
     * @param width            宽；未渲染时为 0
     * @param height           高；未渲染时为 0
     * @param fps              帧率；未渲染时为 0
     * @param resources        本轮用到的三库资源
     * @param requestId        本次创作请求 ID（前端据此核对结果归属）
     * @param userMessageId    触发本次创作的用户消息 ID。
     *                         <p>「未改动工程」这类结论必须能挂到**具体某条消息**上，
     *                         而不是靠「最后一条 AI 回复」推断 —— 否则会把上一轮的结果
     *                         贴到错误的轮次上。前端拿它做归属校验。</p>
     */
    public record CreateResponse(String state, String reply, long agentMs, String artifactPath,
                                 Long version, int durationInFrames,
                                 int width, int height, int fps,
                                 List<UsedResource> resources,
                                 String requestId, String userMessageId) {
    }

    /**
     * 记录一条用户修改意见。
     *
     * <p>追加到 {@code corrections.md}，供 agent 下一轮修改时读取。
     * 不覆盖原始需求。</p>
     *
     * @param projectId 项目 ID
     * @param request   修改意见
     * @return 记录后的状态
     */
    @PostMapping("/corrections")
    public StateResponse correction(@PathVariable String projectId,
                                    @RequestBody CorrectionRequest request) {
        var state = service.recordCorrection(projectId, request.text());
        return StateResponse.of(state);
    }

    /**
     * 修改意见请求。
     *
     * @param text 用户原话
     */
    public record CorrectionRequest(String text) {
    }

    /**
     * 读取项目工程配置。
     *
     * <p>没有配置时返回 {@code ready=false} 而不是 404：
     * 「项目还没有工程」是创作过程的正常阶段，不是错误。</p>
     *
     * @param projectId 项目 ID
     * @return 配置状态
     */
    @GetMapping("/film")
    public FilmResponse film(@PathVariable String projectId) {
        var state = service.state(projectId);
        var config = filmConfig.tryRead(java.nio.file.Path.of(state.directory()));
        if (config.isEmpty()) {
            return new FilmResponse(projectId, false, null, null, null);
        }
        var c = config.get();
        return new FilmResponse(projectId, true, c.entry(), c.compositionId(),
                projectRender.sourceFiles(projectId));
    }

    /**
     * 渲染项目工程并提交为新版本。
     *
     * <p>这是「真实创作」的出口：agent 写的 Remotion 源码在这里被构建、
     * 渲染成 mp4，并留下源码指纹与版本记录。与内置 scenes 渲染不同，
     * 它渲的是项目自己的工程入口。</p>
     *
     * @param projectId 项目 ID
     * @param request   可选的需求说明
     * @return 渲染结果
     */
    @PostMapping("/render")
    public RenderResponse render(@PathVariable String projectId,
                                 @RequestBody(required = false) RenderRequest request) {
        String prompt = request == null ? null : request.prompt();
        var outcome = projectRender.render(projectId, prompt);
        return new RenderResponse(
                outcome.artifactPath(), outcome.version(), outcome.entry(),
                outcome.compositionId(), outcome.result().durationInFrames(),
                outcome.result().width(), outcome.result().height(),
                outcome.result().fps(), outcome.renderMs());
    }

    /**
     * 渲染请求。
     *
     * @param prompt 这次渲染对应的用户要求；可省略
     */
    public record RenderRequest(String prompt) {
    }

    /**
     * 渲染结果。
     *
     * @param artifactPath     产物相对路径
     * @param version          提交的版本号
     * @param entry            使用的入口
     * @param compositionId    使用的 composition
     * @param durationInFrames 时长帧数
     * @param width            宽
     * @param height           高
     * @param fps              帧率
     * @param renderMs         渲染耗时
     */
    public record RenderResponse(String artifactPath, long version, String entry,
                                 String compositionId, int durationInFrames,
                                 int width, int height, int fps, long renderMs) {
    }

    /**
     * 项目工程配置状态。
     *
     * @param projectId     项目 ID
     * @param ready         是否已有可渲染的工程
     * @param entry         入口文件
     * @param compositionId composition ID
     * @param sourceFiles   参与渲染的源码文件
     */
    public record FilmResponse(String projectId, boolean ready, String entry,
                               String compositionId, List<String> sourceFiles) {
    }

    /**
     * 建立上下文的请求。
     *
     * @param prompt 用户原始需求
     */
    public record InitRequest(String prompt) {
    }

    /**
     * 上下文状态响应。
     *
     * @param projectId    项目 ID
     * @param directory    项目目录
     * @param initialized  是否已有 prompt.original.md
     * @param toolAvailable workflow-v0.1.1 工具是否可用
     * @param files        已存在的 Prompt-first 文件
     * @param promptLength 原文长度；-1 表示读不到
     * @param renderedPasses   有视频产物的轮次；-1 表示读不到
     * @param failedPasses     有失败记录、无视频的轮次
     * @param inProgressPasses 目录在但没有产物的轮次
     * @param originalIntegrity 原文完整性：ok / suspect / unknown；未初始化时为 null。
     *                          suspect 表示原文像被旧版工作流拼进了工作稿，只提示、不修改
     * @param originalIntegrityReasons 可疑原因
     */
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
