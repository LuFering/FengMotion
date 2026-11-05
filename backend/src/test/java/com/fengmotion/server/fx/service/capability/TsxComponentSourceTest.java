package com.fengmotion.server.fx.service.capability;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 源码候选发现器（纯规则，不用模型）。
 *
 * <p>这组测试守的是「提取事实」的边界：组件名、props、分类来自源码本身，
 * 而中文名与用途<strong>必须为空</strong> —— 模型没跑之前留空，
 * 编一个看起来合理的描述比不填更危险。</p>
 */
@DisplayName("源码候选发现")
class TsxComponentSourceTest {

    private final TsxComponentSource source = new TsxComponentSource();

    private static final String COMPONENT = """
            /**
             * RollerTypewriter - タイプライター置換
             */

            import { AbsoluteFill, useCurrentFrame } from "remotion";
            import { C, font } from "../../common";

            export const RollerTypewriter = ({ startDelay = 0 }: {
              startDelay?: number;
            }) => {
              const frame = useCurrentFrame();
              return null;
            };
            """;

    @Test
    @DisplayName("提取组件名、props、分类")
    void extractsFacts(@TempDir Path root) throws Exception {
        Path file = root.resolve("scenes/RollerAnimations/RollerTypewriter.tsx");
        Files.createDirectories(file.getParent());
        Files.writeString(file, COMPONENT);

        List<CapabilitySource.ParsedItem> items = source.parse(file, root.resolve("scenes"));
        assertEquals(1, items.size());
        CapabilitySource.ParsedItem item = items.get(0);

        assertEquals("RollerTypewriter", item.name());
        assertEquals("RollerAnimations", item.categoryHint(), "分类应取组件所在目录，不是路径第一段");
        assertEquals("scenes-RollerTypewriter", item.id(), "ID = 扫描根名 + 组件名，与文件路径无关");
        assertTrue(item.steps().stream().anyMatch(s -> s.contains("タイプライター置換")),
                "原注释必须保留，供将来核对模型翻译是否准确");
        assertTrue(item.steps().stream().anyMatch(s -> s.contains("startDelay")));
        assertTrue(item.steps().stream().anyMatch(s -> s.contains("useCurrentFrame")));
    }

    @Test
    @DisplayName("中文名与用途留空：模型没跑之前不编")
    void intentStaysEmpty(@TempDir Path root) throws Exception {
        Path file = root.resolve("scenes/A/SimpleFade.tsx");
        Files.createDirectories(file.getParent());
        Files.writeString(file, COMPONENT.replace("RollerTypewriter", "SimpleFade"));

        CapabilitySource.ParsedItem item = source.parse(file, root.resolve("scenes")).get(0);
        assertEquals("", item.intent(), "用途必须为空，等模型补且经校验");
        assertEquals("", item.nameEn());
    }

    @Test
    @DisplayName("index.tsx 不是组件")
    void skipsIndex() {
        assertFalse(source.supports(Path.of("/x/index.tsx")));
        assertTrue(source.supports(Path.of("/x/Roller.tsx")));
        assertFalse(source.supports(Path.of("/x/README.md")));
    }

    @Test
    @DisplayName("驼峰组件名拆成检索词，让中文用户也能搜到")
    void buildsLatinKeywords() {
        List<String> words = TsxComponentSource.keywords("RollerTypewriter", "RollerAnimations");
        assertTrue(words.contains("roller"));
        assertTrue(words.contains("typewriter"));
    }

    @Test
    @DisplayName("认不出的写法返回空，不硬凑一个组件")
    void unknownShapeYieldsNothing(@TempDir Path root) throws Exception {
        Path file = root.resolve("scenes/A/Weird.tsx");
        Files.createDirectories(file.getParent());
        Files.writeString(file, "export default function Weird() { return null }\n");

        assertTrue(source.parse(file, root.resolve("scenes")).isEmpty(),
                "不是「导出单个匿名组件」的写法，应返回空而不是编名字");
    }

    @Test
    @DisplayName("首块注释能取出「组件名 - 描述」里的描述")
    void readsDocLine() {
        assertEquals("タイプライター置換", TsxComponentSource.firstDocLine(COMPONENT));
        assertEquals("", TsxComponentSource.firstDocLine("const a = 1"));
    }
}
