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
@RequiredArgsConstructor
public class ProjectRenderService {

    private final ProjectRepository projects;
    private final ProjectSceneRepository scenes;
    private final ProjectFilmConfig configs;
    private final ProjectFilmRenderer renderer;
    private final CreateAgentRunner agent;
    private final ResourceContextBuilder resourceContexts;
    private final ObjectMapper json;

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
        Project project = projects.findById(projectId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在"));
        String rootPath = project.rootPath();
        if (rootPath == null || rootPath.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "项目还没有目录");
        }
        Path root = Path.of(rootPath).toAbsolutePath().normalize();

        // 入口与 composition 从项目配置读，缺失/越界都在这里拒绝
        ProjectFilmConfig.FilmConfig config = configs.read(root);

        String fileName = "project-" + Instant.now().toEpochMilli() + ".mp4";
        Path output = root.resolve("renders").resolve(fileName);

        Instant startedAt = Instant.now();
        ProjectFilmRenderer.Result result = renderer.render(root, config, output);
        long elapsedMs = java.time.Duration.between(startedAt, Instant.now()).toMillis();

        JsonNode fingerprint = fingerprint(root, config, result, elapsedMs);

        /* 与「修改」共用版本链：这样项目工程的每一次真实渲染都会推进版本，
           后续修改与回退都基于它。film 字段存的是这次渲染的完整记录，
           而不是 scenes —— 项目工程的「内容」是源码，不是场景 JSON。 */
        long baseVersion = scenes.find(projectId)
                .filter(ProjectScene::present)
                .map(ProjectScene::version)
                .orElse(0L);
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
        var resources = resourceContexts.build(references);

        var agentResult = agent.run(root, intent, resources);
        if (!agentResult.hasEntry() || !agentResult.hasConfig()) {
            String missing = !agentResult.hasEntry()
                    ? "src/index.tsx 没有产出"
                    : ProjectFilmConfig.FILE_NAME + " 没有产出";
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "create_incomplete",
                    "创作 agent 没有给出可渲染的工程（" + missing + "）。它的说明：" + agentResult.reply());
        }

        /* agent 只说话不动手（通常是信息不够，反过来向用户提问）时，绝不能渲染。
           已有工程本来就能渲，渲出来的是上一版画面 —— 用户看到「渲染成功 + 新版本号」，
           会以为改动已经生效。这里如实返回「等你补充信息」，版本链不动。 */
        if (!agentResult.changed()) {
            log.info("创作 agent 未修改工程：project={} reply={}",
                    root.getFileName(), abbreviate(agentResult.reply()));
            return CreateOutcome.awaitingInfo(agentResult.reply(), agentResult.elapsedMs(),
                    resources.resolved());
        }

        RenderOutcome rendered = render(projectId, intent);
        return new CreateOutcome(CreateOutcome.RENDERED, agentResult.reply(), agentResult.elapsedMs(),
                rendered.artifactPath(), rendered.version(), rendered.result(),
                resources.resolved());
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
                .resolve("..").resolve("desktop").resolve("package.json").normalize();
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
