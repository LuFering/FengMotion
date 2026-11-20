package com.fengmotion.server.creation.service;

import com.fengmotion.server.project.service.ProjectFilmConfig;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.service.ProjectSourceFingerprint;

import java.nio.file.Path;
import java.util.Optional;

import org.springframework.stereotype.Component;

import com.fengmotion.server.common.ApiException;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 对话里一轮回复改动了工程，就自动渲染出新版本。
 *
 * <p><strong>为什么需要它</strong>：工作流的制作节点在 agent 之后会渲染，对话却不会 ——
 * agent 改完源码就结束，项目指引又让它不要自己调渲染接口，结果工作台永远出不了片
 * （实测三次运行，{@code renders/} 一直是空的）。这里让两条路径都在改完后出片。</p>
 *
 * <p>判据和制作节点一致：比较这一轮前后的源码指纹，没变就不渲染。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ChatTurnRender {

    private final ProjectCreationService renders;
    private final ProjectFilmConfig configs;
    private final ProjectOperationLock operations;
    private final CreationJobs jobs;

    /**
     * 一次自动渲染的结果。
     *
     * @param state        {@code rendered} 已出片 / {@code failed} 渲染失败 / {@code skipped} 改了源码但没法渲染
     * @param version      出片后的版本号；没出片时为 null
     * @param artifactPath 产物相对路径；没出片时为 null
     * @param message      给用户看的一句话
     */
    public record Result(String state, Long version, String artifactPath, String message) {
        public static final String RENDERED = "rendered";
        public static final String FAILED = "failed";
        public static final String SKIPPED = "skipped";
    }

    /**
     * 这一轮开始前的源码指纹。
     *
     * @return 指纹；会话不属于项目时为 null（之后也不会渲染）
     */
    public String before(String projectId, Path projectRoot) {
        if (projectId == null || projectRoot == null) return null;
        return ProjectSourceFingerprint.compute(projectRoot);
    }

    /**
     * 源码改了就渲染。耗时与一次手动渲染相同（通常 10 到 60 秒）。
     *
     * @param before 这一轮开始前的指纹，见 {@link #before}
     * @param prompt  触发这一轮的用户消息，记进版本说明
     * @param onStart 确定要渲染、开始渲染前调用（用来告诉前端「正在渲染」）；可为 null
     * @return 没改源码时为空；改了就给出出片、失败或跳过的结果
     */
    public Optional<Result> renderIfChanged(String projectId, Path projectRoot, String before, String prompt,
                                            Runnable onStart) {
        if (before == null || before.startsWith("error:")) return Optional.empty();
        String after = ProjectSourceFingerprint.compute(projectRoot);
        if (after.startsWith("error:") || after.equals(before)) return Optional.empty();

        if (configs.tryRead(projectRoot).isEmpty()) {
            return Optional.of(new Result(Result.SKIPPED, null, null,
                    "工程改了，但 film.config.json 还没有指向可用的入口，这一轮没有出片。"));
        }
        if (operations.isBusy(projectId) || jobs.hasActive(projectId)) {
            return Optional.of(new Result(Result.SKIPPED, null, null,
                    "项目正在制作或渲染，这一轮的改动没有自动出片，稍后可在工作台手动渲染。"));
        }
        try {
            if (onStart != null) onStart.run();
            var outcome = renders.render(projectId, prompt);
            return Optional.of(new Result(Result.RENDERED, outcome.version(), outcome.artifactPath(),
                    "已出片 v" + outcome.version() + "。"));
        } catch (ApiException failure) {
            log.warn("对话后自动渲染失败：project={} code={} {}", projectId, failure.getCode(), failure.getMessage());
            return Optional.of(new Result(Result.FAILED, null, null, "自动渲染失败：" + failure.getMessage()));
        } catch (RuntimeException failure) {
            log.warn("对话后自动渲染失败：project={}", projectId, failure);
            return Optional.of(new Result(Result.FAILED, null, null, "自动渲染失败，请在工作台查看工程后手动渲染。"));
        }
    }
}
