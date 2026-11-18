package com.fengmotion.server.skill.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fengmotion.server.common.ApiException;

/** 解压的防线：路径不出目标目录、大小按实际字节计、只解压指定子目录。 */
class SkillArchiveExtractorTest {

    @TempDir Path temp;

    private final SkillArchiveExtractor extractor = new SkillArchiveExtractor(1000, 400, 5);

    private SkillArchiveExtractor.Result extract(byte[] zip, String subPath, Path target) throws Exception {
        return extractor.extract(new ByteArrayInputStream(zip), subPath, target);
    }

    @Test
    @DisplayName("去掉第一层目录，保留包内结构")
    void stripsTopFolder() throws Exception {
        Path target = temp.resolve("out");
        var result = extract(TestZips.github(Map.of("SKILL.md", "# s", "src/a.tsx", "x")), "", target);
        assertEquals(2, result.fileCount());
        assertEquals(4, result.totalBytes());
        assertEquals("# s", Files.readString(target.resolve("SKILL.md")));
        assertTrue(Files.isRegularFile(target.resolve("src/a.tsx")));
    }

    @Test
    @DisplayName("只解压子目录，其余文件不落盘")
    void extractsOnlySubPath() throws Exception {
        Path target = temp.resolve("sub");
        var result = extract(TestZips.github(Map.of(
                "skills/logo/SKILL.md", "# logo",
                "skills/logo-extra/SKILL.md", "# 前缀相同的兄弟目录不能混进来",
                "README.md", "root")), "skills/logo", target);
        assertEquals(1, result.fileCount());
        assertTrue(Files.isRegularFile(target.resolve("SKILL.md")));
        assertFalse(Files.exists(target.resolve("README.md")));
    }

    @Test
    @DisplayName("条目带 .. 、绝对路径或反斜杠：422，不写到目标目录外")
    void rejectsUnsafeEntries() throws Exception {
        for (String name : new String[] {"demo-0123/../../evil.sh", "/etc/evil", "demo-0123\\..\\evil", "demo-0123/./x"}) {
            Path target = temp.resolve("unsafe-" + Math.abs(name.hashCode()));
            var entries = new LinkedHashMap<String, byte[]>();
            entries.put(name, "x".getBytes());
            ApiException error = assertThrows(ApiException.class, () -> extract(TestZips.raw(entries), "", target), name);
            assertEquals("package_unsafe", error.getCode());
            assertEquals(422, error.getStatus().value());
        }
        assertFalse(Files.exists(temp.resolve("evil.sh")));
        assertFalse(Files.exists(temp.getParent().resolve("evil.sh")));
    }

    @Test
    @DisplayName("超过单文件、总量或文件数上限：413")
    void enforcesLimits() throws Exception {
        ApiException single = assertThrows(ApiException.class,
                () -> extract(TestZips.github(Map.of("big.bin", "x".repeat(401))), "", temp.resolve("single")));
        assertEquals("package_too_large", single.getCode());
        assertEquals(413, single.getStatus().value());

        var many = new LinkedHashMap<String, String>();
        for (int i = 0; i < 3; i++) many.put("f" + i, "x".repeat(350));
        ApiException total = assertThrows(ApiException.class, () -> extract(TestZips.github(many), "", temp.resolve("total")));
        assertTrue(total.getMessage().contains("总量"), total.getMessage());

        var count = new LinkedHashMap<String, String>();
        for (int i = 0; i < 6; i++) count.put("f" + i, "x");
        ApiException files = assertThrows(ApiException.class, () -> extract(TestZips.github(count), "", temp.resolve("count")));
        assertTrue(files.getMessage().contains("文件数"), files.getMessage());
    }

    @Test
    @DisplayName("目标目录已存在时拒绝写入，不覆盖")
    void refusesExistingTarget() throws Exception {
        Path target = Files.createDirectories(temp.resolve("exists"));
        assertThrows(java.nio.file.FileAlreadyExistsException.class,
                () -> extract(TestZips.github(Map.of("a", "b")), "", target));
    }
}
