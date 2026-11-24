package com.fengmotion.server.render.service;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.service.ProjectFilmConfig;

class RendererProtocolTest {
    @TempDir Path root;
    private final ObjectMapper json = new ObjectMapper();

    @Test void invalidResultsAndNonzeroExitAreRejectedByBothRenderers() throws Exception {
        String success = "{ok:true,durationInFrames:60,width:640,height:360,fps:30}";
        for (String body : java.util.List.of(
                "console.log(JSON.stringify(" + success + "));process.exitCode=1;",
                "console.log(JSON.stringify({ok:true}));",
                "console.log('null');",
                "console.log(JSON.stringify({..." + success + ",fps:0}));")) {
            assertRejected(body, "render_failed");
        }
        assertRejected("console.log('x'.repeat(2_097_153));", "process_output_too_large");
    }

    private void assertRejected(String body, String code) throws Exception {
        String script = "import {writeFileSync} from 'node:fs';const output=process.argv[process.argv.indexOf('--out')+1];writeFileSync(output,'fixture');" + body;
        Files.writeString(root.resolve("render.mjs"), script);
        Files.writeString(root.resolve("render-project.mjs"), script);
        var project = new ProjectFilmRenderer(json);
        ReflectionTestUtils.setField(project, "remotionDir", root.toString());
        ReflectionTestUtils.setField(project, "nodeBinary", "node");
        ReflectionTestUtils.setField(project, "timeoutSeconds", 10L);
        assertEquals(code, assertThrows(ApiException.class, () -> project.render(root,
                new ProjectFilmConfig.FilmConfig("index.tsx", "Main", 640, 360, 30), root.resolve("project.mp4"))).getCode());
        var renderer = new RemotionRenderer(json);
        ReflectionTestUtils.setField(renderer, "projectDir", root.toString());
        ReflectionTestUtils.setField(renderer, "nodeBinary", "node");
        ReflectionTestUtils.setField(renderer, "timeoutSeconds", 10L);
        assertEquals(code, assertThrows(ApiException.class, () -> renderer.render(json.createObjectNode(), root.resolve("film.mp4"))).getCode());
    }

    @Test void emptyAndLinkedOutputsAreNotSuccessfulArtifacts() throws Exception {
        var result = json.readTree("{\"durationInFrames\":60,\"width\":640,\"height\":360,\"fps\":29.97}");
        Path file = Files.createFile(root.resolve("empty.mp4"));
        assertThrows(ApiException.class, () -> RenderResultValidation.require(result, file));
        Files.writeString(file, "nonempty");
        assertDoesNotThrow(() -> RenderResultValidation.require(result, file));
        Path link = Files.createSymbolicLink(root.resolve("link.mp4"), file);
        assertThrows(ApiException.class, () -> RenderResultValidation.require(result, link));
    }
}
