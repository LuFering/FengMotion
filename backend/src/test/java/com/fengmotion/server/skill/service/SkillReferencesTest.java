package com.fengmotion.server.skill.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fengmotion.server.skill.domain.SkillInventory;

/** 从 SKILL.md 找出提到的组件并带上依赖：snapcn 按名字引用，Boriwatopal 直接写路径和文件名。 */
class SkillReferencesTest {

    @TempDir Path root;

    private SkillInventory scan(Map<String, String> files) throws Exception {
        SnapcnLikePackage.write(root, files);
        return new SkillInventoryScanner().scan(root);
    }

    @Test
    @DisplayName("别名按前缀最长匹配：\"@/*\" 写在前面也不会截走更具体的别名")
    void aliasUsesLongestPrefix() throws Exception {
        SkillInventory inventory = scan(SnapcnLikePackage.files(0, 0));
        var imports = inventory.files().stream().filter(f -> f.path().equals(SnapcnLikePackage.WORDMARK)).findFirst().orElseThrow().imports();
        assertEquals(new SkillInventory.ImportRef("@/lib/snap-cn-ui/motion", "alias", "registry/snap-cn-ui/core/motion.ts"), imports.get(0));
    }

    @Test
    @DisplayName("snapcn：按名字匹配到 skill 目录外的组件，带上共享库，排除测试与没提到的组件")
    void snapcnStyle() throws Exception {
        var files = SnapcnLikePackage.files(0, 0);
        SkillInventory inventory = scan(files);
        var related = SkillReferences.analyze(inventory, SnapcnLikePackage.SKILL, files.get(SnapcnLikePackage.SKILL));

        assertEquals(Set.of(SnapcnLikePackage.ASSEMBLE, SnapcnLikePackage.WORDMARK), Set.copyOf(related.entries()));
        assertTrue(related.dependencies().containsAll(List.of(SnapcnLikePackage.CORE,
                "registry/snap-cn-ui/core/color.ts", "registry/snap-cn-ui/core/motion.ts")), related.dependencies().toString());
        assertTrue(related.dependencies().stream().noneMatch(SkillReferences::isTest), "测试文件不算依赖");
        assertFalse(related.entries().contains("registry/snap-cn/orbit-gallery/index.tsx"), "没提到的组件不算");
        assertEquals(List.of("skills/snapcn/references/components/logo-assemble.md"), related.docs());
    }

    @Test
    @DisplayName("Boriwatopal：SKILL.md 直接写路径或文件名，同样能找到，并带上相对引用的依赖")
    void pathStyle() throws Exception {
        String skill = "skills/mg/SKILL.md";
        String text = "Copy `assets/components/SvgArt.tsx` and Words.tsx into src/.";
        SkillInventory inventory = scan(Map.of(
                skill, text,
                "skills/mg/assets/components/SvgArt.tsx", "import { ease } from '../anim'\nexport const SvgArt = 1\n",
                "skills/mg/assets/components/Words.tsx", "export const Words = 1\n",
                "skills/mg/assets/anim.ts", "export const ease = 1\n",
                "other/Words.tsx", "export const Words = 2\n"));
        var related = SkillReferences.analyze(inventory, skill, text);
        assertEquals(List.of("skills/mg/assets/components/SvgArt.tsx", "skills/mg/assets/components/Words.tsx"), related.entries(),
                "同名文件优先取 skill 目录里的");
        assertEquals(List.of("skills/mg/assets/anim.ts"), related.dependencies());
    }
}
