package com.fengmotion.server.project.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.ShotTimeline;

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
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_config_missing",
                    "项目还没有 " + FILE_NAME + "：请在里面声明 entry 与 compositionId，"
                            + "后端才知道该渲染哪个工程入口。");
        }
        JsonNode node;
        try {
            node = json.reader().with(DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY,
                    DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(Files.readString(file));
        } catch (IOException malformed) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_config_invalid",
                    FILE_NAME + " 不是合法 JSON：" + malformed.getMessage());
        }

        if (node == null || !node.isObject()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_config_invalid", "film.config.json 必须是 JSON 对象");
        }
        if (ShotTimeline.FORMAT.equals(node.path("format").textValue())) {
            return readShotTimeline(projectRoot, node);
        }

        String entry = node.path("entry").asText("").trim();
        String compositionId = node.path("compositionId").asText("").trim();
        if (entry.isEmpty() || compositionId.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_config_invalid",
                    FILE_NAME + " 需要 entry 与 compositionId 两个字段");
        }

        /* 入口必须在项目内：一份被篡改的配置不该让渲染去读任意路径的文件。
           这是执行边界的一环，不是保险丝。 */
        Path reference;
        try { reference = Path.of(entry); }
        catch (java.nio.file.InvalidPathException invalid) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_config_invalid", "entry 不是有效路径");
        }
        Path resolved = projectRoot.resolve(reference).normalize();
        if (reference.isAbsolute() || !resolved.startsWith(projectRoot.normalize())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_config_invalid",
                    "entry 越界：必须位于项目目录内（收到 " + entry + "）");
        }
        if (entry.contains("\\") || !ProjectSourceLayout.contains(reference)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_config_invalid", "entry 不在可备份的源码范围内，请使用根目录源码或 src/components/scenes 等工程目录");
        }
        Path current = projectRoot;
        for (Path part : reference) {
            current = current.resolve(part);
            if (Files.isSymbolicLink(current)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "film_config_invalid", "entry 不能使用符号链接");
            }
        }
        if (!Files.isRegularFile(resolved, LinkOption.NOFOLLOW_LINKS)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "film_entry_missing",
                    "entry 指向的文件不存在：" + entry);
        }

        return new FilmConfig(entry, compositionId,
                node.path("width").asInt(1280),
                node.path("height").asInt(720),
                node.path("fps").asInt(30));
    }

    private FilmConfig readShotTimeline(Path root, JsonNode node) {
        if (!onlyFields(node, Set.of("format", "width", "height", "fps", "shots", "voiceover"))) {
            throw invalidShots("不允许自定义入口、合成或未知字段");
        }
        int width = integer(node.path("width"), 2, 3840, "width");
        int height = integer(node.path("height"), 2, 3840, "height");
        if (width % 2 != 0 || height % 2 != 0) throw invalidShots("画布宽高必须为偶数");
        int fps = integer(node.path("fps"), 1, 60, "fps");
        int maxFrames = 600 * fps;
        JsonNode items = node.path("shots");
        if (!items.isArray() || items.isEmpty() || items.size() > 60) throw invalidShots("需要 1–60 个镜头");

        List<ShotTimeline.Shot> shots = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        int cursor = 0;
        for (JsonNode shot : items) {
            if (!shot.isObject() || !onlyFields(shot, Set.of("id", "sourceId", "label", "frames"))) {
                throw invalidShots("镜头只允许 id、sourceId、label 与 frames");
            }
            String id = identifier(shot.path("id"));
            String sourceId = identifier(shot.path("sourceId"));
            String label = shot.path("label").textValue();
            if (!ids.add(id) || label == null || label.isBlank() || label.length() > 80) {
                throw invalidShots("镜头 ID 必须唯一，label 需要 1–80 字符");
            }
            int frames = integer(shot.path("frames"), 1, maxFrames, "frames");
            requireLocalFile(root, "src/shots/" + sourceId + ".tsx");
            shots.add(new ShotTimeline.Shot(id, sourceId, label, cursor, frames));
            cursor += frames;
            if (cursor > maxFrames) throw invalidShots("总时长不能超过 10 分钟");
        }

        String voiceover = null;
        if (node.has("voiceover")) {
            voiceover = node.path("voiceover").textValue();
            if (voiceover == null || !voiceover.matches("voiceover\\.(wav|mp3|m4a)")) {
                throw invalidShots("voiceover 只接受 public/ 下的 voiceover.wav、voiceover.mp3 或 voiceover.m4a");
            }
            requireLocalFile(root, "public/" + voiceover);
        }
        var timeline = new ShotTimeline(width, height, fps, cursor, List.copyOf(shots), voiceover);
        return new FilmConfig(ShotTimeline.ENTRY, ShotTimeline.COMPOSITION, width, height, fps, timeline);
    }

    private static boolean onlyFields(JsonNode node, Set<String> allowed) {
        var names = node.fieldNames();
        while (names.hasNext()) if (!allowed.contains(names.next())) return false;
        return true;
    }

    private static int integer(JsonNode value, int min, int max, String field) {
        if (!value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < min || value.intValue() > max) {
            throw invalidShots(field + " 必须是 " + min + "–" + max + " 的整数");
        }
        return value.intValue();
    }

    private static String identifier(JsonNode node) {
        String value = node.textValue();
        if (value == null || !value.matches("[a-z][a-z0-9_-]{0,63}")) throw invalidShots("镜头或组件 ID 无效");
        return value;
    }

    private static void requireLocalFile(Path root, String name) {
        Path current = root;
        for (Path part : Path.of(name)) {
            current = current.resolve(part);
            if (Files.isSymbolicLink(current)) throw invalidShots("镜头或音轨不能使用符号链接：" + name);
        }
        if (!Files.isRegularFile(current, LinkOption.NOFOLLOW_LINKS)) throw invalidShots("找不到声明的文件：" + name);
    }

    private static ApiException invalidShots(String message) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "shot_timeline_invalid", message);
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
    public record FilmConfig(String entry, String compositionId, int width, int height, int fps, ShotTimeline shotTimeline) {
        public FilmConfig(String entry, String compositionId, int width, int height, int fps) {
            this(entry, compositionId, width, height, fps, null);
        }
    }
}
