package com.fengmotion.server.fx.service.capability;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 来源配置的 glob 规则。
 *
 * <p>这组测试守的是「规则写错会静默失效」这个具体风险：
 * 实测踩过两次 —— 解析器名写错（配置写 style-directory、代码返回 style），
 * 以及业务目录排除写死在代码里（src 对 lemo 是实现目录，对 remotion-scenes
 * 却是组件本体）。两次都表现为「导入 0 条」，日志却看不出原因。</p>
 */
@DisplayName("来源配置")
class SourceProfileTest {

    @Test
    @DisplayName("双星号跨目录匹配")
    void doubleStarMatchesNested() {
        assertTrue(SourceProfile.globMatch("styles/**/style.json", "styles/art-deco/style.json"));
        assertTrue(SourceProfile.globMatch("src/scenes/**/*.tsx", "src/scenes/RollerAnimations/R.tsx"));
    }

    @Test
    @DisplayName("单星号不跨目录")
    void singleStarStaysInOneLevel() {
        assertFalse(SourceProfile.globMatch("references/*.md", "references/shots/a.md"));
        assertTrue(SourceProfile.globMatch("references/*.md", "references/pipeline.md"));
    }

    @Test
    @DisplayName("exclude 优先于 include")
    void excludeWinsOverInclude() {
        SourceProfile profile = new SourceProfile("t", "t",
                List.of("**/*.tsx"), List.of("**/index.tsx"), "top", List.of(), false);

        assertTrue(profile.accepts("src/scenes/A/B.tsx"), "普通组件应收");
        assertFalse(profile.accepts("src/scenes/A/index.tsx"), "index 是导出清单，必须排除");
    }

    @Test
    @DisplayName("include 为空表示全收（但排除仍生效）")
    void emptyIncludeAcceptsAll() {
        SourceProfile profile = new SourceProfile("t", "t", List.of(), List.of("**/README*"),
                "parent", List.of(), false);

        assertTrue(profile.accepts("anything/here.md"));
        assertFalse(profile.accepts("docs/README.md"));
    }

    @Test
    @DisplayName("lemo 的 demo 目录被排除，避免台词与音乐提示被当成技法")
    void excludesLemoDemo() {
        SourceProfile lemo = new SourceProfile("lemo-opuscar", "lemo-opuscar",
                List.of("styles/**/style.json"),
                List.of("**/demo/**", "**/_template/**"),
                "parent", List.of("style-directory"), false);

        assertTrue(lemo.accepts("styles/art-deco/style.json"));
        assertFalse(lemo.accepts("styles/art-deco/demo/lines.json"), "demo 里的台词不是技法");
        assertFalse(lemo.accepts("styles/_template/style.json"), "模板不是真实风格");
    }

    @Test
    @DisplayName("shotcraft 只收 shots 下的卡，references 下的流程文档被排除")
    void shotcraftOnlyTakesShots() {
        SourceProfile shots = new SourceProfile("video-shotcraft", "video-shotcraft",
                List.of("references/shots/**/*.md"),
                List.of("references/*.md", "**/sequences/**", "**/ATTRIBUTION*"),
                "parent", List.of("front-matter"), false);

        assertTrue(shots.accepts("references/shots/camera/basic-3d-scene.md"));
        assertFalse(shots.accepts("references/pipeline.md"), "流程文档不是技法");
        assertFalse(shots.accepts("references/sequences/promo-energy-arc.md"));
        assertFalse(shots.accepts("references/shots/ATTRIBUTION.md"));
    }

    @Test
    @DisplayName("remotion-scenes 收 src 下的组件、排除 index")
    void remotionTakesComponents() {
        SourceProfile scenes = new SourceProfile("remotion-scenes", "remotion-scenes",
                List.of("src/scenes/**/*.tsx"), List.of("**/index.tsx"),
                "top", List.of("tsx-component"), true);

        assertTrue(scenes.accepts("src/scenes/RollerAnimations/RollerTypewriter.tsx"));
        assertFalse(scenes.accepts("src/scenes/RollerAnimations/index.tsx"));
        assertTrue(scenes.needsModel());
    }
}
