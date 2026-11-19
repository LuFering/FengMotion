package com.fengmotion.server.preset.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;

import com.fengmotion.server.preset.domain.PresetMapping;
import com.fengmotion.server.skill.client.GithubArchiveClient;
import com.fengmotion.server.skill.domain.SkillPackage;
import com.fengmotion.server.skill.service.SkillPackageService;
import com.fengmotion.server.skill.service.TestZips;

/** 导入一个 logo 动画 skill 样本包，并给出一份合格的映射。 */
final class PresetFixtures {
    static final String SKILL = "skills/logo/SKILL.md";
    static final String COMPONENT = "skills/logo/src/Logo.tsx";

    private PresetFixtures() {
    }

    static SkillPackage importLogoSkill(SkillPackageService service, GithubArchiveClient github) throws Exception {
        String repo = "logo-" + UUID.randomUUID().toString().substring(0, 8);
        String sha = UUID.randomUUID().toString().replace("-", "") + "00000000";
        var files = new LinkedHashMap<String, String>();
        files.put(SKILL, "---\nname: logo-reveal\ndescription: Logo 动效\n---\n# 流程\n```bash\nbash scripts/check.sh\n```\n");
        files.put("skills/logo/README.md", "# 说明\n路径描绘 → 元素依次出现 → 组合 → 稳定\n");
        files.put(COMPONENT, "import {spring} from 'remotion'\nexport const Logo = () => null\n");
        files.put("skills/logo/scripts/check.sh", "#!/bin/bash\nffprobe out.mp4\n");
        byte[] zip = TestZips.github(files);
        when(github.resolveCommit(eq("acme"), eq(repo), isNull())).thenReturn(sha);
        when(github.openZip(any(), eq(repo), eq(sha))).thenAnswer(i -> new ByteArrayInputStream(zip));
        return service.importPackage("acme/" + repo, null, null).skillPackage();
    }

    static PresetMapping mapping(String name, String lookdev) {
        return new PresetMapping(name, "品牌 Logo 的入场动效", "logo-animation", "品牌名：\nLogo 文件：\n时长：",
                new PresetMapping.Defaults("8 秒", "16:9"),
                List.of(new PresetMapping.RequiredInput("asset", "品牌 Logo（SVG 优先）", true)),
                lookdev, "# 导演处理（Logo）", List.of("Logo 最终帧是否清晰", "各元素出现顺序是否符合描绘路径"),
                List.of(new PresetMapping.GuideSection("路径描绘", "先描边再填色，最后整体缓动稳定。", List.of(SKILL, "skills/logo/README.md"))),
                List.of(new PresetMapping.Component(COMPONENT, "SVG 分路径动画")),
                List.of(new PresetMapping.CommandDecision("bash scripts/check.sh", "replace-with-builtin", "用本项目渲染检查")),
                List.of(new PresetMapping.StepMapping("检查已渲染的关键帧", "review", null, "inspect")),
                List.of(new PresetMapping.Unmapped("分析参考视频", "参考分析由用户在素材与参考里提供")),
                List.of("model-made-this-up"));
    }
}
