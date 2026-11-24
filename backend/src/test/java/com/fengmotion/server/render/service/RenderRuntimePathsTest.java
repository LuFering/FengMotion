package com.fengmotion.server.render.service;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fengmotion.server.common.ApiException;

class RenderRuntimePathsTest {
    @TempDir Path root;
    @Test void resolvesDevelopmentLayoutsAndNeverIgnoresAnExplicitBadPath() throws Exception {
        String previous=System.getProperty("user.dir");
        try {
            Path backend=Files.createDirectories(root.resolve("backend/remotion"));
            Files.writeString(backend.resolve("render-project.mjs"),"");
            System.setProperty("user.dir",root.toString());
            assertEquals(backend.resolve("render-project.mjs"),RenderRuntimePaths.script("","render-project.mjs"));
            System.setProperty("user.dir",root.resolve("backend").toString());
            assertEquals(backend.resolve("render-project.mjs"),RenderRuntimePaths.script("","render-project.mjs"));
            assertEquals("renderer_unavailable",assertThrows(ApiException.class,()->RenderRuntimePaths.script(root.resolve("missing").toString(),"render-project.mjs")).getCode());
        } finally { System.setProperty("user.dir",previous); }
    }
}
