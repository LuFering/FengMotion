package com.fengmotion.server.workflow.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;

/**
 * 对话一轮改动了工程才自动出片。
 *
 * <p>实测：对话里 agent 写好了整套工程，但没有任何环节渲染，{@code renders/} 一直是空的。</p>
 */
class ChatTurnRenderTest {

    @TempDir Path root;

    private final ProjectRenderService renders = mock(ProjectRenderService.class);
    private final CreationJobs jobs = mock(CreationJobs.class);
    private final ProjectOperationLock operations = new ProjectOperationLock();
    private ChatTurnRender turnRender;

    @BeforeEach
    void setUp() throws Exception {
        turnRender = new ChatTurnRender(renders, new ProjectFilmConfig(new ObjectMapper()), operations, jobs);
        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "registerRoot(Root)");
    }

    private void writeConfig() throws Exception {
        Files.writeString(root.resolve("film.config.json"), "{\"entry\":\"src/index.tsx\",\"compositionId\":\"Caffeine\"}");
    }

    @Test
    void doesNothingWhenSourceDidNotChange() throws Exception {
        writeConfig();
        String before = turnRender.before("p1", root);
        assertTrue(turnRender.renderIfChanged("p1", root, before, "咖啡", null).isEmpty());
        verify(renders, never()).render(any(), any());
    }

    @Test
    void rendersChangedSourceAndReportsVersion() throws Exception {
        String before = turnRender.before("p1", root);
        writeConfig();
        Files.writeString(root.resolve("src/Caffeine.tsx"), "export const Caffeine = () => null");
        when(renders.render("p1", "咖啡")).thenReturn(
                new ProjectRenderService.RenderOutcome("renders/project-1.mp4", 3, "src/index.tsx", "Caffeine", null, 1000));
        AtomicBoolean started = new AtomicBoolean();

        var result = turnRender.renderIfChanged("p1", root, before, "咖啡", () -> started.set(true)).orElseThrow();

        assertEquals(ChatTurnRender.Result.RENDERED, result.state());
        assertEquals(3L, result.version());
        assertEquals("renders/project-1.mp4", result.artifactPath());
        assertTrue(started.get(), "开始渲染前要先通知，前端才能显示「正在渲染」");
    }

    @Test
    void skipsWithReasonWhenThereIsNoRenderableEntry() throws Exception {
        String before = turnRender.before("p1", root);
        Files.writeString(root.resolve("src/Caffeine.tsx"), "export const Caffeine = () => null");

        var result = turnRender.renderIfChanged("p1", root, before, "咖啡", null).orElseThrow();

        assertEquals(ChatTurnRender.Result.SKIPPED, result.state());
        assertTrue(result.message().contains("film.config.json"));
        verify(renders, never()).render(any(), any());
    }

    @Test
    void skipsWhileTheProjectIsBusy() throws Exception {
        String before = turnRender.before("p1", root);
        writeConfig();
        operations.acquire("p1");

        var result = turnRender.renderIfChanged("p1", root, before, "咖啡", null).orElseThrow();

        assertEquals(ChatTurnRender.Result.SKIPPED, result.state());
        verify(renders, never()).render(any(), any());
    }

    @Test
    void reportsRenderFailureInsteadOfThrowing() throws Exception {
        String before = turnRender.before("p1", root);
        writeConfig();
        when(renders.render("p1", "咖啡")).thenThrow(new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "render_failed", "打包失败：语法错误"));

        var result = turnRender.renderIfChanged("p1", root, before, "咖啡", null).orElseThrow();

        assertEquals(ChatTurnRender.Result.FAILED, result.state());
        assertTrue(result.message().contains("打包失败"));
    }

    @Test
    void sessionWithoutProjectNeverRenders() {
        assertEquals(null, turnRender.before(null, root));
        assertTrue(turnRender.renderIfChanged(null, root, null, "咖啡", null).isEmpty());
    }
}
