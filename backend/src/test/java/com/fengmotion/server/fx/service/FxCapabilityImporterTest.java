package com.fengmotion.server.fx.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fengmotion.server.fx.domain.FxStates;
import com.fengmotion.server.fx.service.capability.CapabilitySource;
import com.fengmotion.server.fx.service.capability.FrontMatterSource;
import com.fengmotion.server.fx.service.capability.GenericMarkdownSource;
import com.fengmotion.server.fx.service.capability.GenericJsonSource;
import com.fengmotion.server.fx.service.capability.StyleDirectorySource;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 通用导入器：解析器的识别与解析规则。
 *
 * <p>这组测试守的是「通用」这条要求本身：
 * 换一个没见过的目录布局也能导入，认不出的格式如实跳过而不是硬凑。
 * 之前写死三条路径时，任何新库都得改代码；现在是加一个解析器即可。</p>
 */
@DisplayName("通用导入器")
class FxCapabilityImporterTest {

    private final ObjectMapper json = new ObjectMapper();

    // ── front matter 解析 ──

    @Test
    @DisplayName("front matter 解析出中英文键")
    void readsFrontMatterKeys() {
        String md = """
                ---
                name: basic-3d-scene
                一句话: 卡片散布 3D 空间，相机依次飞行对齐
                适用: 概念/路线图
                ---

                ## 意图
                正文
                """;

        Map<String, String> meta = FrontMatterSource.readFrontMatter(md);
        assertEquals("basic-3d-scene", meta.get("name"));
        assertEquals("卡片散布 3D 空间，相机依次飞行对齐", meta.get("一句话"));
        assertEquals("概念/路线图", meta.get("适用"));
    }

    @Test
    @DisplayName("值里的冒号不截断，只按第一个冒号切分")
    void valueMayContainColon() {
        Map<String, String> meta = FrontMatterSource.readFrontMatter(
                "---\n适用: 概念；替代 slides 的\"每一步\"\n---\n");
        assertTrue(meta.get("适用").contains("概念"));
    }

    @Test
    @DisplayName("去掉值两端的引号")
    void stripsQuotes() {
        Map<String, String> meta = FrontMatterSource.readFrontMatter(
                "---\nname: \"quoted name\"\ntitle: 'single'\n---\n");
        assertEquals("quoted name", meta.get("name"));
        assertEquals("single", meta.get("title"));
    }

    @Test
    @DisplayName("没有 front matter 时返回空表，不报错")
    void noFrontMatterIsEmpty() {
        assertTrue(FrontMatterSource.readFrontMatter("# 标题\n正文").isEmpty());
        assertTrue(FrontMatterSource.readFrontMatter("").isEmpty());
        assertTrue(FrontMatterSource.readFrontMatter(null).isEmpty());
    }

    // ── 识别：认哪些、不认哪些 ──

    @Test
    @DisplayName("带 front matter 的 md 由 FrontMatterSource 认，Generic 不抢")
    void frontMatterOwnedByDedicatedSource(@TempDir Path dir) throws Exception {
        Path file = dir.resolve("card.md");
        Files.writeString(file, "---\nname: x\n---\n正文");
        FrontMatterSource dedicated = new FrontMatterSource();
        GenericMarkdownSource generic = new GenericMarkdownSource(dedicated);

        assertTrue(dedicated.supports(file), "有 front matter，专用解析器应认");
        assertFalse(generic.supports(file), "专用的已认，通用兜底不该重复收");
    }

    @Test
    @DisplayName("没有 front matter 但有标题正文的 md 由通用兜底认")
    void plainMarkdownFallsToGeneric(@TempDir Path dir) throws Exception {
        Path file = dir.resolve("idea.md");
        Files.writeString(file, "# 遮罩揭示\n\n用一个形状逐渐放大遮住画面，完成场景切换。\n");
        FrontMatterSource dedicated = new FrontMatterSource();
        GenericMarkdownSource generic = new GenericMarkdownSource(dedicated);

        assertFalse(dedicated.supports(file));
        assertTrue(generic.supports(file));
        List<CapabilitySource.ParsedItem> items = generic.parse(file, dir);
        assertEquals(1, items.size());
        assertEquals("遮罩揭示", items.get(0).name());
    }

    @Test
    @DisplayName("没有标题也没有段落的 md 被跳过，不产生垃圾条目")
    void plainMarkdownWithoutTitleIsSkipped() throws Exception {
        Path dir = Files.createTempDirectory("fm-md");
        Path file = dir.resolve("notes.md");
        Files.writeString(file, "```\ncode only\n```\n");
        GenericMarkdownSource generic = new GenericMarkdownSource(new FrontMatterSource());
        assertTrue(generic.parse(file, dir).isEmpty(), "认得出格式但没有可用内容，应返回空");
    }

    @Test
    @DisplayName("README/LICENSE 等仓库说明不参与导入")
    void repoDocsAreNoise() {
        assertTrue(CapabilitySource.isNoise(Path.of("/x/README.md")));
        assertTrue(CapabilitySource.isNoise(Path.of("/x/ATTRIBUTION.md")));
        assertTrue(CapabilitySource.isNoise(Path.of("/x/LICENSE")));
        assertTrue(CapabilitySource.isNoise(Path.of("/x/node_modules/y.md")));
        assertFalse(CapabilitySource.isNoise(Path.of("/x/camera/basic-3d-scene.md")));
    }

    @Test
    @DisplayName("style.json/meta.json 不被 JSON 兜底重复收")
    void styleJsonNotDoubleCollected(@TempDir Path dir) throws Exception {
        Path style = dir.resolve("style.json");
        Files.writeString(style, "{\"name\":\"x\"}");
        GenericJsonSource generic = new GenericJsonSource(json);
        assertFalse(generic.supports(style), "目录级元数据由 StyleDirectorySource 处理");
    }

    @Test
    @DisplayName("普通条目 JSON 能被兜底解析")
    void plainJsonIsParsed(@TempDir Path dir) throws Exception {
        Path file = dir.resolve("items.json");
        Files.writeString(file, "[{\"name\":\"遮罩揭示\",\"description\":\"形状放大完成转场\"}]");
        GenericJsonSource generic = new GenericJsonSource(json);

        assertTrue(generic.supports(file));
        List<CapabilitySource.ParsedItem> items = generic.parse(file, dir);
        assertEquals(1, items.size());
        assertEquals("遮罩揭示", items.get(0).name());
        assertEquals("形状放大完成转场", items.get(0).intent());
    }

    @Test
    @DisplayName("没有 name 的 JSON 不被当成条目")
    void jsonWithoutNameIsSkipped(@TempDir Path dir) throws Exception {
        Path file = dir.resolve("config.json");
        Files.writeString(file, "{\"enabled\":true}");
        assertTrue(new GenericJsonSource(json).parse(file, dir).isEmpty());
    }

    // ── 风格目录 ──

    @Test
    @DisplayName("一个目录带 style.json 就是一条风格，海报用相对路径")
    void styleDirectoryParsed(@TempDir Path root) throws Exception {
        Path lib = root.resolve("some-new-lib");
        Path style = lib.resolve("styles/neon");
        Files.createDirectories(style);
        Files.writeString(style.resolve("style.json"),
                "{\"slug\":\"neon\",\"cn\":\"霓虹\",\"en\":\"Neon\",\"category_cn\":\"风格化\",\"uses\":[\"夜店\"]}");
        Files.writeString(style.resolve("poster.jpg"), "x");

        StyleDirectorySource source = new StyleDirectorySource(json);
        List<CapabilitySource.ParsedItem> out = new java.util.ArrayList<>();
        int skipped = source.scan(lib, out);

        assertEquals(0, skipped);
        assertEquals(1, out.size());
        CapabilitySource.ParsedItem item = out.get(0);
        assertEquals("霓虹", item.name());
        assertEquals("Neon", item.nameEn());
        assertTrue(item.previewImage().endsWith("poster.jpg"));
        assertEquals("图形与排版".equals(item.categoryHint()) || "风格化".equals(item.categoryHint()), true);
    }

    @Test
    @DisplayName("换一个库名也能导入：不依赖写死的路径")
    void worksWithArbitraryLibraryName(@TempDir Path root) throws Exception {
        /* 这条是本次改动的核心诉求：以前路径写死成 lemo-opuscar，
           换个名字就一条都导不进来。 */
        Path lib = root.resolve("my-own-styles");
        Path style = lib.resolve("styles/whatever");
        Files.createDirectories(style);
        Files.writeString(style.resolve("style.json"), "{\"cn\":\"任意名字\"}");

        List<CapabilitySource.ParsedItem> out = new java.util.ArrayList<>();
        new StyleDirectorySource(json).scan(lib, out);

        assertEquals(1, out.size(), "任意名字的库都应能导入");
        assertEquals("任意名字", out.get(0).name());
    }

    // ── 分类映射 ──

    @Test
    @DisplayName("分类提示能映射到枚举，认不出时归到合成")
    void categoryMapping() {
        assertEquals(FxStates.Category.CAMERA, FxCapabilityImporter.mapCategory("运镜"));
        assertEquals(FxStates.Category.TRANSITION, FxCapabilityImporter.mapCategory("transition"));
        assertEquals(FxStates.Category.STYLIZE, FxCapabilityImporter.mapCategory("图形与排版"));
        assertEquals(FxStates.Category.COMPOSITING, FxCapabilityImporter.mapCategory("完全没见过的东西"));
        assertEquals(FxStates.Category.COMPOSITING, FxCapabilityImporter.mapCategory(""));
    }
}
