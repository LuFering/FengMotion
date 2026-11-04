package com.fengmotion.server.workflow.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 项目级 Remotion 工程配置。
 *
 * <p><strong>为什么要有配置文件</strong>：渲染必须知道入口文件和 composition ID。
 * 不能假设每个作品都叫 {@code src/index.tsx} 和 {@code Main} ——
 * 那是把某一部片的结构当成产品规则。让项目自己声明，后端校验它是否真实存在。</p>
 *
 * <p>配置文件是 {@code film.config.json}，放在项目根：</p>
 * <pre>{@code
 * {
 *   "entry": "src/index.tsx",
 *   "compositionId": "Main",
 *   "width": 1280,
 *   "height": 720,
 *   "fps": 30
 * }
 * }</pre>
 *
 * <p>只读不改：这份文件由创作 agent 写，后端只负责校验与使用。
 * 缺字段就明确报错，不猜一个默认值 —— 猜错会渲出一部不是用户要的片子。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProjectFilmConfig {

    private final ObjectMapper json;

    /** 配置文件名。 */
    public static final String FILE_NAME = "film.config.json";

    /**
     * 读取并校验项目配置。
     *
     * @param projectRoot 项目根目录
     * @return 配置
     * @throws ApiException 文件缺失、字段不全或入口越界
     */
    public FilmConfig read(Path projectRoot) {
        Path file = projectRoot.resolve(FILE_NAME);
        if (!Files.isRegularFile(file)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_config_missing",
                    "项目还没有 " + FILE_NAME + "：请在里面声明 entry 与 compositionId，"
                            + "后端才知道该渲染哪个工程入口。");
        }
        JsonNode node;
        try {
            node = json.readTree(Files.readString(file));
        } catch (IOException malformed) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_config_invalid",
                    FILE_NAME + " 不是合法 JSON：" + malformed.getMessage());
        }

        String entry = node.path("entry").asText("").trim();
        String compositionId = node.path("compositionId").asText("").trim();
        if (entry.isEmpty() || compositionId.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_config_invalid",
                    FILE_NAME + " 需要 entry 与 compositionId 两个字段");
        }

        /* 入口必须在项目内：一份被篡改的配置不该让渲染去读任意路径的文件。
           这是执行边界的一环，不是保险丝。 */
        Path resolved = projectRoot.resolve(entry).normalize();
        if (!resolved.startsWith(projectRoot.normalize())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_config_invalid",
                    "entry 越界：必须位于项目目录内（收到 " + entry + "）");
        }
        if (!Files.isRegularFile(resolved)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_entry_missing",
                    "entry 指向的文件不存在：" + entry);
        }

        return new FilmConfig(entry, compositionId,
                node.path("width").asInt(1280),
                node.path("height").asInt(720),
                node.path("fps").asInt(30));
    }

    /**
     * 读取配置，缺失时返回空（用于「这个项目有没有工程」的判断）。
     *
     * @param projectRoot 项目根目录
     * @return 配置或空
     */
    public Optional<FilmConfig> tryRead(Path projectRoot) {
        try {
            return Optional.of(read(projectRoot));
        } catch (ApiException notReady) {
            return Optional.empty();
        }
    }

    /**
     * 项目工程配置。
     *
     * @param entry         入口文件（相对项目根）
     * @param compositionId Remotion composition ID
     * @param width         画布宽（仅作记录；实际以 composition 为准）
     * @param height        画布高
     * @param fps           帧率
     */
    public record FilmConfig(String entry, String compositionId, int width, int height, int fps) {
    }
}
