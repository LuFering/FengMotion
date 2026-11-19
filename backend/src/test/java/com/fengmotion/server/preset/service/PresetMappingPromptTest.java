package com.fengmotion.server.preset.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.time.Instant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fengmotion.server.skill.domain.SkillPackage;
import com.fengmotion.server.skill.service.SkillInventoryScanner;
import com.fengmotion.server.skill.service.SnapcnLikePackage;

/** 映射提示：skill 目录外的组件即使排在几百个文件之后，也要出现在清单最前面，并给出正文节选。 */
class PresetMappingPromptTest {

    @TempDir Path root;

    @Test
    @DisplayName("SKILL.md 提到的组件和依赖排在清单最前；组件正文给节选并记进 truncatedSources")
    void prioritizesReferencedComponents() throws Exception {
        SnapcnLikePackage.write(root, SnapcnLikePackage.files(600, 6000));
        var report = new SkillInventoryScanner().scan(root);
        var pkg = new SkillPackage("pkg", "acme", "snapcn", null, "a".repeat(40), "", root.toString(),
                report.summary().files(), report.summary().totalBytes(), report, Instant.now());

        var built = PresetMappingPrompt.build(pkg, SnapcnLikePackage.SKILL);
        String prompt = built.prompt();

        int section = prompt.indexOf("### SKILL.md 提到的组件");
        int deps = prompt.indexOf("### 这些组件的依赖");
        assertTrue(section >= 0 && deps > section, prompt.substring(0, Math.min(800, prompt.length())));
        assertTrue(prompt.indexOf(SnapcnLikePackage.ASSEMBLE) > section && prompt.indexOf(SnapcnLikePackage.ASSEMBLE) < deps);
        assertTrue(prompt.indexOf(SnapcnLikePackage.CORE) > deps, "共享库列在依赖里");
        assertTrue(prompt.contains("<<<FILE " + SnapcnLikePackage.ASSEMBLE + "（节选）>>>"), "超长组件只放节选");
        assertTrue(built.truncatedSources().contains(SnapcnLikePackage.ASSEMBLE));
        assertTrue(prompt.contains("<<<FILE skills/snapcn/references/components/logo-assemble.md>>>"), "同名组件文档放进正文");
        assertFalse(prompt.contains("<<<FILE " + SnapcnLikePackage.CORE), "依赖只列路径，不放正文");
        assertTrue(prompt.contains("其余"), "超过 500 条的文件如实说明未列出");
    }
}
