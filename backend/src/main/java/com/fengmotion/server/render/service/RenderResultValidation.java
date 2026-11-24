package com.fengmotion.server.render.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;

import org.springframework.http.HttpStatus;

import com.fasterxml.jackson.databind.JsonNode;
import com.fengmotion.server.common.ApiException;

final class RenderResultValidation {
    private RenderResultValidation() { }

    static void require(JsonNode result, Path output) {
        if (result == null || !result.isObject() || !positiveInteger(result.path("durationInFrames"))
                || !positiveInteger(result.path("width")) || !positiveInteger(result.path("height"))
                || !result.path("fps").isNumber() || !Double.isFinite(result.path("fps").doubleValue())
                || result.path("fps").doubleValue() < 1 || result.path("fps").doubleValue() > 240) {
            throw invalid("渲染结果缺少有效的帧数、画布或帧率");
        }
        if (output != null) {
            try {
                if (!Files.isRegularFile(output, LinkOption.NOFOLLOW_LINKS) || Files.size(output) == 0) {
                    throw invalid("渲染报告成功但没有产出非空文件");
                }
            } catch (IOException failure) { throw invalid("渲染产物无法核对"); }
        }
    }

    private static boolean positiveInteger(JsonNode value) {
        return value.isIntegralNumber() && value.canConvertToInt() && value.intValue() > 0;
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "render_failed", message);
    }
}
