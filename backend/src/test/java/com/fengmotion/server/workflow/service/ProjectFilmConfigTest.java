package com.fengmotion.server.workflow.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

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
