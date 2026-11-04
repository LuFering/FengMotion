package com.fengmotion.server.catalog.service;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;

class RemotionRendererTimeoutTest {
    @TempDir Path project;

    @Test
    void capturesLargeStderrWithoutBlockingSuccessfulRender() throws Exception {
        Files.writeString(project.resolve("render.mjs"),
                "head -c 131072 /dev/zero >&2\ntouch \"$4\"\nprintf '{\"ok\":true,\"fps\":30}'\n");
        var mapper = new ObjectMapper();
        var renderer = new RemotionRenderer(mapper);
        ReflectionTestUtils.setField(renderer, "projectDir", project.toString());
        ReflectionTestUtils.setField(renderer, "nodeBinary", "/bin/sh");
        ReflectionTestUtils.setField(renderer, "timeoutSeconds", 5L);

        assertEquals(30, renderer.render(mapper.createObjectNode(), project.resolve("out.mp4")).fps());
    }

    @Test
    void hangingProcessTimesOutEvenWhenOutputStreamsStayOpen() throws Exception {
        Files.writeString(project.resolve("render.mjs"), "echo started >&2\nexec sleep 30\n");
        var mapper = new ObjectMapper();
        var renderer = new RemotionRenderer(mapper);
        ReflectionTestUtils.setField(renderer, "projectDir", project.toString());
        ReflectionTestUtils.setField(renderer, "nodeBinary", "/bin/sh");
        ReflectionTestUtils.setField(renderer, "timeoutSeconds", 1L);

        ApiException error = assertTimeoutPreemptively(Duration.ofSeconds(5), () ->
                assertThrows(ApiException.class, () -> renderer.render(mapper.createObjectNode(), project.resolve("out.mp4"))));
        assertEquals("render_timeout", error.getCode());
    }
}
