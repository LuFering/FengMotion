package com.fengmotion.server.skill.service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** 在内存里构造与 GitHub codeload 同形的 zip：第一层是 {@code <repo>-<sha>/}。 */
public final class TestZips {
    private TestZips() {
    }

    /** 条目名原样写入（不加前缀），用于构造不安全的条目。 */
    public static byte[] raw(Map<String, byte[]> entries) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes)) {
            for (var e : entries.entrySet()) {
                zip.putNextEntry(new ZipEntry(e.getKey()));
                if (e.getValue() != null) zip.write(e.getValue());
                zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }

    /** 文本条目，自动加 {@code demo-<sha>/} 前缀和目录条目。 */
    public static byte[] github(Map<String, String> files) throws IOException {
        var entries = new java.util.LinkedHashMap<String, byte[]>();
        entries.put("demo-0123/", null);
        files.forEach((path, text) -> entries.put("demo-0123/" + path, text.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        return raw(entries);
    }
}
