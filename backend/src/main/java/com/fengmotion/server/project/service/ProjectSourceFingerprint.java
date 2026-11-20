package com.fengmotion.server.project.service;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.stream.Stream;

import lombok.extern.slf4j.Slf4j;

@Slf4j
public final class ProjectSourceFingerprint {
    public static final String EMPTY = "files=0;sha256=empty";

    private ProjectSourceFingerprint() {}

    public static String compute(Path projectRoot) {
        try {
            List<Path> files = new ArrayList<>();
            for (String directory : List.of("src", "public")) {
                Path folder = projectRoot.resolve(directory);
                if (!Files.isDirectory(folder)) continue;
                try (Stream<Path> walk = Files.walk(folder)) {
                    files.addAll(walk.filter(Files::isRegularFile).toList());
                }
            }
            for (String name : List.of("film.config.json", "package.json")) {
                Path file = projectRoot.resolve(name);
                if (Files.isRegularFile(file)) files.add(file);
            }
            if (files.isEmpty()) return EMPTY;
            files.sort(Comparator.naturalOrder());
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[65536];
            for (Path file : files) {
                digest.update(projectRoot.relativize(file).toString().getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
                try (var input = Files.newInputStream(file)) {
                    int count;
                    while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
                }
                digest.update((byte) 0);
            }
            return "files=" + files.size() + ";sha256=" + HexFormat.of().formatHex(digest.digest());
        } catch (Exception failure) {
            log.warn("计算源码指纹失败：{}", projectRoot, failure);
            return "error:" + failure.getClass().getSimpleName();
        }
    }
}
