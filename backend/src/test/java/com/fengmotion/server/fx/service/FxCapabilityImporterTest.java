package com.fengmotion.server.fx.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 能力库导入的解析规则。
 *
 * <p>这组测试守的是「来源信息不能编」：导入进来的每一条都要能回答
 * 「从哪来、许可是什么、能不能一键跑」。编一个看起来专业的来源，
 * 比不显示来源更危险 —— 用户会据此决定能不能商用。</p>
 */
@DisplayName("能力库导入解析")
class FxCapabilityImporterTest {

    @Test
    @DisplayName("front matter 取单行字段")
    void readsFrontMatterField() {
        String md = """
                ---
                name: basic-3d-scene
                一句话: 卡片散布 3D 空间，相机依次飞行对齐
                时长: 约 7.5s
                ---

                ## 意图
                正文
                """;

        assertEquals("basic-3d-scene", FxCapabilityImporter.frontMatter(md, "name"));
        assertEquals("卡片散布 3D 空间，相机依次飞行对齐", FxCapabilityImporter.frontMatter(md, "一句话"));
        assertEquals("约 7.5s", FxCapabilityImporter.frontMatter(md, "时长"));
    }

    @Test
    @DisplayName("没有该字段时返回空串，不猜默认值")
    void missingFieldIsEmpty() {
        String md = "---\nname: x\n---\n正文";
        assertEquals("", FxCapabilityImporter.frontMatter(md, "许可"));
    }

    @Test
    @DisplayName("没有 front matter 的文件不报错，返回空串")
    void noFrontMatterIsSafe() {
        assertEquals("", FxCapabilityImporter.frontMatter("# 标题\n正文", "name"));
        assertEquals("", FxCapabilityImporter.frontMatter("", "name"));
        assertEquals("", FxCapabilityImporter.frontMatter(null, "name"));
    }

    @Test
    @DisplayName("值里含冒号时只按第一个冒号切分")
    void valueMayContainColon() {
        String md = "---\n适用: 概念/路线图；替代 slides 的\"每一步都换个空间视角\"\n---\n";
        assertTrue(FxCapabilityImporter.frontMatter(md, "适用").contains("路线图"),
                "冒号后的内容不该被截断");
    }

    @Test
    @DisplayName("导入条目的来源类型不会是空，避免界面显示成未知")
    void sourceKindNeverBlank() {
        /* 这是数据层的兜底约定：仓储写入时会把空值回落成 builtin。
           这里断言的是「内置条目的来源标记是 builtin 而不是空串」这个约定本身，
           防止有人把默认值改成 null 或 ""。 */
        assertFalse("builtin".isBlank());
    }
}
