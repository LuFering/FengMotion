package com.fengmotion.server.skill.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fengmotion.server.skill.domain.SkillInventory;
import com.fengmotion.server.skill.domain.SkillInventory.ImportRef;

/**
 * 静态清点：只读、只解析，结果确定。
 *
 * <p>样本包按真实 skill 包的形态构造：多个 skill、带 tsconfig 路径别名的 Remotion 组件、
 * 带 shebang 的脚本、package.json scripts，以及 SKILL.md 里要求运行的命令。</p>
 */
class SkillInventoryScannerTest {

    @TempDir Path root;
    private final SkillInventoryScanner scanner = new SkillInventoryScanner();

    private void write(String path, String content) throws Exception {
        Path file = root.resolve(path);
        Files.createDirectories(file.getParent());
        Files.writeString(file, content);
    }

    @BeforeEach
    void samplePackage() throws Exception {
        write("skills/motion/SKILL.md", """
                ---
                name: remotion-motion-graphics
                description: 从参考到成片的动效流程
                metadata:
                  tags: [logo, svg]
                ---

                # 流程

                先分析参考：`node scripts/analyze.mjs ref.mp4`，组件里用 `useCurrentFrame`。

                ```bash
                # 渲染后检查
                bash scripts/check_render.sh out.mp4
                $ npx remotion render
                ```

                ```tsx
                const x = 1
                ```
                """);
        write("skills/broken/SKILL.md", "---\nname: [unclosed\n---\n正文\n");
        write("skills/nofm/SKILL.md", "# 没有 frontmatter\n");
        write("src/SvgArt.tsx", """
                import React from 'react'
                import {spring, useCurrentFrame} from 'remotion'
                import {ease} from './anim'
                import {gone} from '../missing'
                import {Button} from '@/components/ui/button'
                import fs from 'node:fs'
                import path from 'path'
                export * from './layout.js'
                const player = require('@remotion/player/lib')
                """);
        write("src/anim.ts", "export const ease = 1\n");
        write("src/layout.ts", "export const layout = 1\n");
        write("src/components/ui/button.tsx", "export const Button = () => null\n");
        write("tsconfig.json", """
                {
                  // shadcn 的路径别名
                  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] }, },
                }
                """);
        write("package.json", """
                {"name": "demo", "license": "MIT",
                 "scripts": {"render": "remotion render"},
                 "dependencies": {"react": "^19.0.0", "remotion": "4.0.200"},
                 "devDependencies": {"@remotion/cli": "4.0.200"}}
                """);
        write("scripts/check_render.sh", "#!/bin/bash\nffprobe \"$1\"\n");
        write("scripts/analyze.mjs", "#!/usr/bin/env node\nimport {execSync} from 'child_process'\n");
        write("LICENSE", "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n");
        write("assets/logo.svg", "<svg/>");
        Files.write(root.resolve("assets/music.mp3"), new byte[] {0, 1, 2, 3});
    }

    private SkillInventory.FileEntry file(SkillInventory report, String path) {
        return report.files().stream().filter(f -> f.path().equals(path)).findFirst().orElseThrow();
    }

    private ImportRef ref(SkillInventory report, String specifier) {
        return file(report, "src/SvgArt.tsx").imports().stream()
                .filter(i -> i.specifier().equals(specifier)).findFirst().orElseThrow();
    }

    @Test
    @DisplayName("识别全部 SKILL.md：frontmatter 正常、格式错误、缺失三种情况都如实记录")
    void parsesSkills() throws Exception {
        SkillInventory report = scanner.scan(root);
        assertEquals(3, report.skills().size());

        var motion = report.skills().stream().filter(s -> s.path().equals("skills/motion/SKILL.md")).findFirst().orElseThrow();
        assertEquals("skills/motion", motion.directory());
        assertEquals("remotion-motion-graphics", motion.name());
        assertEquals("从参考到成片的动效流程", motion.description());
        assertEquals(Map.of("tags", List.of("logo", "svg")), motion.frontmatter().get("metadata"), "嵌套字段要原样保留");
        assertNull(motion.frontmatterError());

        var broken = report.skills().stream().filter(s -> s.path().equals("skills/broken/SKILL.md")).findFirst().orElseThrow();
        assertNotNull(broken.frontmatterError(), "格式错误不能当成没有字段");
        assertNull(broken.name());

        assertTrue(report.warnings().stream().anyMatch(w -> w.contains("skills/nofm/SKILL.md") && w.contains("没有 frontmatter")));
    }

    @Test
    @DisplayName("文件分类：shebang 优先于扩展名，许可证文件算文档")
    void categorizesFiles() throws Exception {
        SkillInventory report = scanner.scan(root);
        assertEquals("skill", file(report, "skills/motion/SKILL.md").category());
        assertEquals("component", file(report, "src/SvgArt.tsx").category());
        assertEquals("code", file(report, "src/anim.ts").category());
        assertEquals("script", file(report, "scripts/check_render.sh").category());
        assertEquals("script", file(report, "scripts/analyze.mjs").category(), "带 shebang 的 .mjs 是可执行脚本");
        assertEquals("config", file(report, "package.json").category());
        assertEquals("config", file(report, "tsconfig.json").category());
        assertEquals("asset", file(report, "assets/music.mp3").category());
        assertEquals("doc", file(report, "LICENSE").category());
        assertEquals(64, file(report, "src/anim.ts").sha256().length());
        assertNull(file(report, "LICENSE").imports(), "非代码文件不提取 import");
    }

    @Test
    @DisplayName("脚本与 SKILL.md 里要求运行的命令全部列出，不执行")
    void listsScriptsAndInstructedCommands() throws Exception {
        SkillInventory report = scanner.scan(root);
        assertTrue(report.scripts().stream().anyMatch(s -> s.path().equals("scripts/check_render.sh") && s.kind().equals("file")));
        assertTrue(report.scripts().stream().anyMatch(s -> s.path().equals("scripts/analyze.mjs") && s.reason().contains("shebang")));
        assertTrue(report.scripts().stream().anyMatch(s -> s.kind().equals("npm-script") && "render".equals(s.name())));

        List<String> commands = report.instructedCommands().stream().map(SkillInventory.InstructedCommand::command).toList();
        assertTrue(commands.contains("bash scripts/check_render.sh out.mp4"), commands.toString());
        assertTrue(commands.contains("npx remotion render"), "去掉 $ 提示符：" + commands);
        assertTrue(commands.contains("node scripts/analyze.mjs ref.mp4"), "行内代码里的命令：" + commands);
        assertFalse(commands.contains("useCurrentFrame"), "普通行内代码不是命令");
        assertFalse(commands.contains("# 渲染后检查"), "注释不是命令");
        assertFalse(commands.contains("const x = 1"), "非 shell 代码块不算命令");
    }

    @Test
    @DisplayName("import 分四类：相对路径、npm 包、Node 内置、tsconfig 路径别名")
    void classifiesImports() throws Exception {
        SkillInventory report = scanner.scan(root);
        assertEquals(new ImportRef("./anim", "relative", "src/anim.ts"), ref(report, "./anim"));
        assertEquals(new ImportRef("../missing", "relative", null), ref(report, "../missing"));
        assertEquals(new ImportRef("./layout.js", "relative", "src/layout.ts"), ref(report, "./layout.js"),
                "TypeScript ESM 写 .js 指向 .ts");
        assertEquals(new ImportRef("@/components/ui/button", "alias", "src/components/ui/button.tsx"),
                ref(report, "@/components/ui/button"));
        assertEquals("builtin", ref(report, "node:fs").kind());
        assertEquals("builtin", ref(report, "path").kind());
        assertEquals(new ImportRef("@remotion/player/lib", "package", "@remotion/player"), ref(report, "@remotion/player/lib"));
        assertEquals(1, report.summary().unresolvedImports());
    }

    @Test
    @DisplayName("npm 依赖对照：声明、实际用到、用到却没声明；Remotion 版本单独列出")
    void comparesDependencies() throws Exception {
        SkillInventory report = scanner.scan(root);
        var deps = report.dependencies();
        assertTrue(deps.approximate());
        assertEquals(List.of("@remotion/player", "react", "remotion"), deps.used());
        assertEquals(List.of("@remotion/player"), deps.undeclared());
        assertEquals(Map.of("@remotion/cli", "4.0.200", "remotion", "4.0.200"), deps.remotionPackages());
    }

    @Test
    @DisplayName("许可证：按文件内容识别，同时保留 package.json 的声明")
    void detectsLicense() throws Exception {
        SkillInventory report = scanner.scan(root);
        assertEquals("MIT", report.license().spdx());
        assertEquals(List.of("LICENSE"), report.license().files());
        assertEquals("MIT", report.license().packageJsonLicense());
    }

    @Test
    @DisplayName("同一份内容两次清点结果相同")
    void isDeterministic() throws Exception {
        assertEquals(scanner.scan(root), scanner.scan(root));
    }

    @Test
    @DisplayName("没有 SKILL.md 时给出警告，许可证认不出时标 unknown")
    void warnsWhenNotASkillPackage() throws Exception {
        Path other = root.resolve("other");
        Files.createDirectories(other);
        Files.writeString(other.resolve("README.md"), "# hi");
        Files.writeString(other.resolve("LICENSE"), "All rights reserved.");
        SkillInventory report = scanner.scan(other);
        assertEquals(0, report.skills().size());
        assertTrue(report.warnings().stream().anyMatch(w -> w.contains("没有找到 SKILL.md")));
        assertEquals("unknown", report.license().spdx());
    }
}
