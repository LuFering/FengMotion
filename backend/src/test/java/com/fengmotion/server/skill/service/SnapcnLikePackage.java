package com.fengmotion.server.skill.service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 仿 snapcn 结构的样本包：logo skill 目录里只有 SKILL.md，组件放在 registry/ 下，
 * 共享库靠 tsconfig 路径别名引入，而且 "@/*" 写在更具体的别名前面。
 */
public final class SnapcnLikePackage {
    public static final String SKILL = "skills/remotion-logo-animation/SKILL.md";
    public static final String ASSEMBLE = "registry/snap-cn/logo-assemble/index.tsx";
    public static final String WORDMARK = "registry/snap-cn/wordmark-cut/index.tsx";
    public static final String CORE = "registry/snap-cn-ui/core/index.ts";

    private SnapcnLikePackage() {
    }

    public static Map<String, String> files(int fillers, int componentPadding) {
        Map<String, String> files = new LinkedHashMap<>();
        for (int i = 0; i < fillers; i++) files.put(String.format("aaa/filler-%04d.md", i), "# filler " + i);
        files.put(SKILL, """
                ---
                name: remotion-logo-animation
                description: Logo 动画
                ---
                | Scene | Frames |
                |---|---|
                | `logo-assemble` | 108 |

                Launch opener: see the `remotion-launch-video` skill. Use `staticFile` for assets.

                ```bash
                npx shadcn@latest add @snapcn/logo-assemble @snapcn/wordmark-cut
                ```

                ```tsx
                import { LogoAssemble } from "@/components/snap-cn/logo-assemble";
                ```
                """);
        files.put(ASSEMBLE, "import { Item } from \"@/lib/snap-cn-ui\";\nimport { missing } from \"@/components/ui/missing\";\n"
                + "/** A ring of image cards collapses into the logo. */\nexport function LogoAssemble() { return null }\n"
                + "// " + "x".repeat(componentPadding) + "\n");
        files.put("registry/snap-cn/logo-assemble/__tests__/logo-assemble.test.ts", "import { LogoAssemble } from '../index'\n");
        files.put(WORDMARK, "import { ease } from \"@/lib/snap-cn-ui/motion\";\nexport function WordmarkCut() { return null }\n");
        files.put("registry/snap-cn/orbit-gallery/index.tsx", "export function OrbitGallery() { return null }\n");
        files.put(CORE, "export * from './color'\nexport * from './motion'\n");
        files.put("registry/snap-cn-ui/core/color.ts", "export const color = 1\n");
        files.put("registry/snap-cn-ui/core/motion.ts", "export const ease = 1\n");
        files.put("registry/snap-cn-ui/core/__tests__/color.test.ts", "import { color } from '../color'\n");
        files.put("skills/snapcn/references/components/logo-assemble.md", "# logo-assemble\nProps: logoSrc, brandName, images\n");
        files.put("tsconfig.json", """
                { "compilerOptions": { "paths": {
                    "@/*": ["./*"],
                    "@/lib/snap-cn-ui": ["./registry/snap-cn-ui/core/index.ts"],
                    "@/lib/snap-cn-ui/*": ["./registry/snap-cn-ui/core/*"]
                } } }
                """);
        files.put("LICENSE", "MIT License\n\nPermission is hereby granted, free of charge, to any person\n");
        return files;
    }

    public static void write(Path root, Map<String, String> files) throws Exception {
        for (var e : files.entrySet()) {
            Path file = root.resolve(e.getKey());
            Files.createDirectories(file.getParent());
            Files.writeString(file, e.getValue());
        }
    }
}
