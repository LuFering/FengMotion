package com.fengmotion.server.project.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;

/**
 * 项目工程配置的读取与校验。
 *
 * <p>入口与 composition 不能假设、不能猜：猜错会渲出一部不是用户要的片子，
 * 而用户只会看到「渲染成功」。所以这里每一条拒绝路径都要钉住。</p>
 */
@DisplayName("项目工程配置")
class ProjectFilmConfigTest {

    private static final String ASSEMBLY = """
            {"format":"shot-timeline-v1","width":960,"height":540,"fps":30,
             "shots":[{"id":"chart","sourceId":"cards","label":"对比","frames":120},
                      {"id":"end","sourceId":"cards","label":"片尾","frames":90}],"voiceover":"voiceover.wav"}
            """;

    private final ProjectFilmConfig configs = new ProjectFilmConfig(new ObjectMapper());

    @TempDir
    Path root;

    /**
     * 写一份配置。
     *
     * @param content 内容
     */
    private void writeConfig(String content) throws Exception {
        Files.writeString(root.resolve(ProjectFilmConfig.FILE_NAME), content);
    }

    private void shotFiles() throws Exception {
        Files.createDirectories(root.resolve("src/shots"));
        Files.writeString(root.resolve("src/shots/cards.tsx"), "export const Shot = () => null;");
        Files.createDirectories(root.resolve("public"));
        Files.writeString(root.resolve("public/voiceover.wav"), "audio fixture");
    }

    @Test
    void derivesStableInstanceTimingWithoutAnAgentOwnedEntry() throws Exception {
        shotFiles();
        writeConfig(ASSEMBLY);

        var config = configs.read(root);
        var timeline = config.shotTimeline();
        assertEquals(".fengmotion-shot-entry.tsx", config.entry());
        assertFalse(Files.exists(root.resolve(config.entry())));
        assertEquals(210, timeline.durationInFrames());
        assertEquals("chart", timeline.shots().getFirst().id());
        assertEquals(120, timeline.shots().getLast().startFrame());
        assertEquals("voiceover.wav", timeline.voiceover());
    }

    @ParameterizedTest
    @ValueSource(strings = {"entry", "duplicate", "escape", "empty", "fraction", "audio", "nested-start"})
    void refusesInvalidAssembly(String mode) throws Exception {
        shotFiles();
        writeConfig(switch (mode) {
            case "entry" -> ASSEMBLY.replace("\"width\"", "\"entry\":\"src/index.tsx\",\"width\"");
            case "duplicate" -> ASSEMBLY.replace("\"end\"", "\"chart\"");
            case "escape" -> ASSEMBLY.replace("\"cards\"", "\"../cards\"");
            case "empty" -> ASSEMBLY.replace("\"frames\":120", "\"frames\":0");
            case "fraction" -> ASSEMBLY.replace("\"fps\":30", "\"fps\":29.97");
            case "audio" -> ASSEMBLY.replace("voiceover.wav", "voiceover.mp3");
            default -> ASSEMBLY.replace("\"frames\":120", "\"frames\":120,\"startFrame\":7");
        });

        assertEquals("shot_timeline_invalid", assertThrows(ApiException.class, () -> configs.read(root)).getCode());
    }

    @Test
    @DisplayName("正常配置被读出")
    void readsValidConfig() throws Exception {
        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "export {}");
        writeConfig("""
                {"entry":"src/index.tsx","compositionId":"HeroShot","width":1920,"height":1080,"fps":25}
                """);

        var config = configs.read(root);

        assertEquals("src/index.tsx", config.entry());
        assertEquals("HeroShot", config.compositionId(), "不能假设叫 Main");
        assertEquals(1920, config.width());
        assertEquals(25, config.fps());
    }

    @Test
    void rejectsLocalAbsoluteUntrackedAndLinkedEntriesBeforeRendering() throws Exception {
        Files.writeString(root.resolve("index.tsx"), "export {}");
        Files.createDirectory(root.resolve("untracked"));
        Files.writeString(root.resolve("untracked/index.tsx"), "export {}");
        Files.createSymbolicLink(root.resolve("link.tsx"), root.resolve("index.tsx"));
        Files.createSymbolicLink(root.resolve("components"), root.resolve("untracked"));
        for (String entry : java.util.List.of(root.resolve("index.tsx").toString(),
                "untracked/index.tsx", "link.tsx", "components/index.tsx", "src/../index.tsx", "src\\index.tsx")) {
            writeConfig(new ObjectMapper().createObjectNode().put("entry", entry).put("compositionId", "Main").toString());
            assertEquals("film_config_invalid", assertThrows(ApiException.class, () -> configs.read(root), entry).getCode());
        }
        writeConfig("{\"entry\":\"index.tsx\",\"compositionId\":\"Main\"}");
        assertEquals("index.tsx", configs.read(root).entry());
    }

    @Test
    @DisplayName("没有配置时明确报错，不猜默认入口")
    void rejectsMissingConfig() {
        var e = assertThrows(ApiException.class, () -> configs.read(root));
        assertEquals("film_config_missing", e.getCode());
        assertTrue(e.getMessage().contains("film.config.json"), e.getMessage());
    }

    @Test
    @DisplayName("缺 entry 或 compositionId 时报错，不用默认值补")
    void rejectsIncompleteConfig() throws Exception {
        writeConfig("{\"entry\":\"src/index.tsx\"}");
        var e = assertThrows(ApiException.class, () -> configs.read(root));
        assertEquals("film_config_invalid", e.getCode());
        assertTrue(e.getMessage().contains("compositionId"), e.getMessage());
    }

    @Test
    @DisplayName("entry 指向项目外时拒绝：执行边界的一环")
    void rejectsEntryOutsideProject() throws Exception {
        writeConfig("{\"entry\":\"../../etc/passwd\",\"compositionId\":\"Main\"}");

        var e = assertThrows(ApiException.class, () -> configs.read(root));

        assertEquals("film_config_invalid", e.getCode());
        assertTrue(e.getMessage().contains("越界"), e.getMessage());
    }

    @Test
    @DisplayName("entry 文件不存在时报错")
    void rejectsMissingEntryFile() throws Exception {
        writeConfig("{\"entry\":\"src/nope.tsx\",\"compositionId\":\"Main\"}");
        var e = assertThrows(ApiException.class, () -> configs.read(root));
        assertEquals("film_entry_missing", e.getCode());
    }

    @Test
    @DisplayName("非法 JSON 时报错")
    void rejectsMalformedJson() throws Exception {
        writeConfig("{not json");
        var e = assertThrows(ApiException.class, () -> configs.read(root));
        assertEquals("film_config_invalid", e.getCode());
    }

    @Test
    @DisplayName("tryRead 在没配置时返回空，供「还没有工程」判断")
    void tryReadIsEmptyWhenAbsent() {
        assertTrue(configs.tryRead(root).isEmpty());
    }

    @Test
    @DisplayName("tryRead 在配置无效时也返回空，不抛给调用方")
    void tryReadIsEmptyWhenInvalid() throws Exception {
        writeConfig("{\"entry\":\"src/x.tsx\"}");
        assertTrue(configs.tryRead(root).isEmpty());
    }

    @Test
    @DisplayName("正常配置在 tryRead 下可读到")
    void tryReadReturnsConfig() throws Exception {
        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), "export {}");
        writeConfig("{\"entry\":\"src/index.tsx\",\"compositionId\":\"Main\"}");

        assertFalse(configs.tryRead(root).isEmpty());
    }
}
