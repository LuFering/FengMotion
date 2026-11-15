package com.fengmotion.server.workflow.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.ProjectScene;
import com.fengmotion.server.project.domain.ProjectSceneVersion;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 渲染项目工程并留下可追溯的版本。
 *
 * <p><strong>为什么要留源码指纹</strong>：预览、正式渲染、后续修改必须能回答
 * 「这条片子是哪一版代码渲出来的」。没有这个，用户看到的视频与目录里的源码
 * 一旦不同步，就再也对不上了 —— 而 agent 会持续改文件。</p>
 *
 * <p>记录内容：源文件清单与各自的大小/修改时间哈希、工程配置、依赖版本、
 * 本次渲染的尺寸与时长。这些字段进 {@code project_scene_versions.film}，
 * 与「修改」路径共用同一条版本链。</p>
 */
@Slf4j
@Service
public class ProjectRenderService {

    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ProjectFilmConfig configs;
    private final ProjectFilmRenderer renderer;
    private final CreateAgentRunner agent;
    private final ResourceContextBuilder resourceContexts;
    private final ObjectMapper json;
    private final CreationStateStore creationStates;
    private final CreationTaskStore creationTasks;
    private final com.fengmotion.server.chat.service.ChatMessageService chatMessages;

    private final ProjectOperationLock operations;
    private final ProjectSourceSnapshots sourceSnapshots;
    private final WorkflowProjectService workflowProject;

    @org.springframework.beans.factory.annotation.Autowired
    public ProjectRenderService(
            ProjectRepository projects,
            ProjectSceneRepository scenes,
            ProjectFilmConfig configs,
            ProjectFilmRenderer renderer,
            CreateAgentRunner agent,
            ResourceContextBuilder resourceContexts,
            ObjectMapper json,
            CreationStateStore creationStates,
            CreationTaskStore creationTasks,
            com.fengmotion.server.chat.service.ChatMessageService chatMessages,
            ProjectOperationLock operations,
            ProjectSourceSnapshots sourceSnapshots,
            WorkflowProjectService workflowProject) {
        this.projects = projects;
        this.scenes = scenes;
        this.configs = configs;
        this.renderer = renderer;
        this.agent = agent;
        this.resourceContexts = resourceContexts;
        this.json = json;
        this.creationStates = creationStates;
        this.creationTasks = creationTasks;
        this.chatMessages = chatMessages;
        this.operations = operations;
        this.sourceSnapshots = sourceSnapshots;
        this.workflowProject = workflowProject;
    }

    public ProjectRenderService(
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
        this(projects, scenes, configs, filmRenderer, agent, resourceContexts, json, creationStates, null, null, operations, sourceSnapshots, workflowProject);
    }

    /** 源码目录：只扫这些，避免把 renders/ 与依赖缓存算进指纹。 */
    private static final List<String> SOURCE_DIRS = List.of("src");

    /** 参与指纹的源码扩展名。 */
    private static final List<String> SOURCE_EXTENSIONS = List.of(
            ".tsx", ".ts", ".jsx", ".js", ".mjs", ".css", ".json");

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
        Project project = projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        String rootPath = project.rootPath();
        if (rootPath == null || rootPath.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目还没有目录");
        }
        Path root = Path.of(rootPath).toAbsolutePath().normalize();

        // 入口与 composition 从项目配置读，缺失/越界都在这里拒绝
        configs.read(root);
        String sourceSnapshot = sourceSnapshots.capture(root);
        Path renderRoot = sourceSnapshots.resolve(root, sourceSnapshot);
        ProjectFilmConfig.FilmConfig config = configs.read(renderRoot);

        String fileName = "project-" + Instant.now().toEpochMilli() + ".mp4";
        Path output = root.resolve("renders").resolve(fileName);

        long baseVersion = scenes.find(projectId)
                .filter(ProjectScene::present).map(ProjectScene::version).orElse(0L);
        Instant startedAt = Instant.now();
        ProjectFilmRenderer.Result result = renderer.render(renderRoot, config, output);
        long elapsedMs = java.time.Duration.between(startedAt, Instant.now()).toMillis();

        ObjectNode fingerprint = (ObjectNode) fingerprint(renderRoot, config, result, elapsedMs);
        fingerprint.put("sourceSnapshot", sourceSnapshot);
        fingerprint.put("sourceHash", CreateAgentRunner.sourceFingerprint(renderRoot));
        var creation = creationStates.read(root);
        if (creation != null && creation.references() != null) fingerprint.set("resources", creation.references());

        /* 与「修改」共用版本链：这样项目工程的每一次真实渲染都会推进版本，
           后续修改与回退都基于它。film 字段存的是这次渲染的完整记录，
           而不是 scenes —— 项目工程的「内容」是源码，不是场景 JSON。 */
        Optional<Long> committed = scenes.commitWithSnapshot(
                projectId, baseVersion, fingerprint, null,
                prompt == null ? "" : prompt,
                "渲染项目工程 " + config.entry() + " · " + config.compositionId(),
                "renders/" + fileName,
                ProjectSceneVersion.SOURCE_TASK, null);

        if (committed.isEmpty()) {
            /* 并发：渲染期间别人提交了版本。产物保留，但不冒充当前版本。 */
            try {
                Files.deleteIfExists(output);
            } catch (IOException ignored) {
                // 删不掉也不影响结论
            }
            throw new ApiException(HttpStatus.CONFLICT, "scene_version_conflict",
                    "项目在你渲染期间被更新了，本次结果未提交");
        }

        return new RenderOutcome("renders/" + fileName, committed.get(),
                config.entry(), config.compositionId(), result, elapsedMs);
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
        operations.acquire(projectId);
        try {
            if (requestId != null && !requestId.isBlank()) {
                String requestHash = computeFingerprint(projectId, intent, references, previewImage, expectedVersion, correction);
                var existingTask = creationTasks.findByRequestId(requestId);
                if (existingTask.isPresent()) {
                    var task = existingTask.get();
                    if (!requestHash.equals(task.requestHash())) {
                        throw new ApiException(HttpStatus.CONFLICT, "task_idempotency_conflict",
                                "请求 ID 已用于不同创作任务");
                    }
                    if (CreateOutcome.RENDERED.equals(task.status()) || CreateOutcome.AWAITING_INFO.equals(task.status())) {
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
                            if (CreateOutcome.RENDERED.equals(raceTask.status()) || CreateOutcome.AWAITING_INFO.equals(raceTask.status())) {
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
                if (expectedVersion != null) {
                    long actualVersion = scenes.find(projectId).filter(ProjectScene::present).map(ProjectScene::version).orElse(0L);
                    if (actualVersion != expectedVersion) {
                        throw new ApiException(HttpStatus.CONFLICT, "version_conflict", "项目版本已变化，请刷新预览并重新选择修改目标。");
                    }
                }
                if (previewImage != null) CreateAgentRunner.previewImages(previewImage);
                if (correction != null && !correction.isBlank()) workflowProject.recordCorrection(projectId, correction, requestId);
                return createUnlocked(projectId, intent, references, previewImage, requestId, sessionId, userMessageId);
            } catch (RuntimeException failure) {
                if (requestId != null && !requestId.isBlank()) {
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
            String idemKey = "idem-reply-" + (userMessageId != null && !userMessageId.isBlank() ? userMessageId : requestId);
            chatMessages.send(
                    sessionId,
                    new com.fengmotion.server.chat.api.dto.CreateChatMessageRequest(
                            reply, null, null, com.fengmotion.server.chat.domain.ChatMessage.ROLE_ASSISTANT, userMessageId
                    ),
                    idemKey
            );
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
        // 省略资源表示继续上轮选择；显式 [] 才表示清空，避免回答追问时丢掉素材。
        JsonNode effectiveRefs = references == null || references.isNull()
                ? previous == null ? null : previous.references() : references;
        var resources = resourceContexts.build(effectiveRefs);
        String instruction = intent;
        if (previous != null && CreateOutcome.AWAITING_INFO.equals(previous.state())) {
            instruction = "上一轮用户要求：\n" + previous.intent()
                    + "\nAgent 上一轮的说明/问题：\n" + previous.reply()
                    + "\n用户本轮补充：\n" + (intent == null ? "按已有要求继续" : intent);
        }
        creationStates.write(root, creationStates.state("running", intent, null, effectiveRefs, null, null, null, requestId, "analyzing"));
        if (requestId != null && !requestId.isBlank()) {
            creationTasks.updatePhase(requestId, "analyzing");
        }
        String reply = null;
        try {
            var agentResult = agent.run(root, instruction, resources, previewImage, projectId, sessionId, requestId);
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

            creationStates.write(root, creationStates.state("running", intent, reply, effectiveRefs, null, null, null, requestId, "rendering"));
            if (requestId != null && !requestId.isBlank()) {
                creationTasks.updatePhase(requestId, "rendering");
            }

            configs.read(root);
            RenderOutcome rendered = renderUnlocked(projectId, intent);
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

        /** agent 没有改动工程，通常在等用户补充信息。 */
        public static final String AWAITING_INFO = "awaiting_info";

        /** 本轮没有渲染：版本与产物都为空，前端据此显示「等待补充」而不是播放器。 */
        public static CreateOutcome awaitingInfo(String reply, long agentMs,
                java.util.List<ResourceContextBuilder.ResolvedResource> resources) {
            return new CreateOutcome(AWAITING_INFO, reply, agentMs, null, null, null, resources);
        }
    }

    /**
     * 截断日志里的长文本。
     *
     * @param text 原文
     * @return 不超过 200 字的片段
     */
    private String abbreviate(String text) {
        if (text == null) return "";
        String flat = text.replace('\n', ' ').strip();
        return flat.length() <= 200 ? flat : flat.substring(0, 200) + "…";
    }

    /**
     * 生成这次渲染的指纹：源码清单、配置、依赖版本、产物规格。
     *
     * @param root      项目根
     * @param config    工程配置
     * @param result    渲染结果
     * @param elapsedMs 耗时
     * @return JSON
     */
    private JsonNode fingerprint(Path root, ProjectFilmConfig.FilmConfig config,
                                 ProjectFilmRenderer.Result result, long elapsedMs) {
        ObjectNode node = json.createObjectNode();
        node.put("kind", "project-render");
        node.put("entry", config.entry());
        node.put("compositionId", config.compositionId());

        ObjectNode output = node.putObject("output");
        output.put("durationInFrames", result.durationInFrames());
        output.put("width", result.width());
        output.put("height", result.height());
        output.put("fps", result.fps());
        output.put("renderMs", elapsedMs);

        // 源码清单：谁改了哪个文件，事后能对出来
        ArrayNode sources = node.putArray("sources");
        for (String dir : SOURCE_DIRS) {
            Path dirPath = root.resolve(dir);
            if (!Files.isDirectory(dirPath)) continue;
            try (Stream<Path> walk = Files.walk(dirPath)) {
                for (Path file : walk.filter(Files::isRegularFile).toList()) {
                    String name = file.getFileName().toString().toLowerCase();
                    if (SOURCE_EXTENSIONS.stream().noneMatch(name::endsWith)) continue;
                    ObjectNode item = sources.addObject();
                    item.put("path", root.relativize(file).toString().replace('\\', '/'));
                    item.put("bytes", Files.size(file));
                    item.put("modifiedAt", Files.getLastModifiedTime(file).toInstant().toString());
                }
            } catch (IOException unreadable) {
                log.warn("读取源码清单失败：{}", dirPath);
            }
        }

        node.set("dependencies", dependencyVersions());
        return node;
    }

    /**
     * 记录共享运行时的版本，便于回答「这条片子用的哪个 Remotion」。
     *
     * <p>读不到就留空对象，不编造版本号 —— 假装知道比不知道更糟。</p>
     *
     * @return 依赖版本
     */
    private JsonNode dependencyVersions() {
        ObjectNode node = json.createObjectNode();
        Path pkg = Path.of(System.getProperty("user.dir"))
                .resolve("..").resolve("frontend").resolve("package.json").normalize();
        if (!Files.isRegularFile(pkg)) return node;
        try {
            JsonNode root = json.readTree(Files.readString(pkg));
            Map<String, String> keys = Map.of(
                    "remotion", "remotion",
                    "@remotion/renderer", "@remotion/renderer",
                    "@remotion/bundler", "@remotion/bundler",
                    "react", "react");
            for (var entry : keys.entrySet()) {
                JsonNode deps = root.path("dependencies").has(entry.getKey())
                        ? root.path("dependencies") : root.path("devDependencies");
                String version = deps.path(entry.getKey()).asText("");
                if (!version.isBlank()) node.put(entry.getKey(), version);
            }
        } catch (IOException unreadable) {
            // 读不到就不写，保持空对象
        }
        return node;
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
        List<String> out = new ArrayList<>();
        for (String dir : SOURCE_DIRS) {
            Path dirPath = root.resolve(dir);
            if (!Files.isDirectory(dirPath)) continue;
            try (Stream<Path> walk = Files.walk(dirPath)) {
                walk.filter(Files::isRegularFile).forEach(f -> out.add(
                        root.relativize(f).toString().replace('\\', '/')));
            } catch (IOException unreadable) {
                // 读不到就返回已收集的部分
            }
        }
        return out;
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
