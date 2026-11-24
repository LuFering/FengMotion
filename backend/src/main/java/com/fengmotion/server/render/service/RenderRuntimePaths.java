package com.fengmotion.server.render.service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.springframework.http.HttpStatus;
import com.fengmotion.server.common.ApiException;

final class RenderRuntimePaths {
    private RenderRuntimePaths() { }
    static Path script(String configured,String name) {
        if(configured!=null && !configured.isBlank()) {
            Path script=Path.of(configured).toAbsolutePath().normalize().resolve(name);
            if(Files.isRegularFile(script)) return script;
            throw missing(name);
        }
        Path cwd=Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        for(Path directory:List.of(cwd.resolve("remotion"),cwd.resolve("backend/remotion"),cwd.resolve("FengMotion-desktop/backend/remotion"),cwd.resolve("resources/remotion"))) {
            if(Files.isRegularFile(directory.resolve(name))) return directory.resolve(name);
        }
        throw missing(name);
    }
    private static ApiException missing(String name) {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"renderer_unavailable","找不到渲染脚本 "+name+"，请核对 fengmotion.remotion.project-dir");
    }
}
