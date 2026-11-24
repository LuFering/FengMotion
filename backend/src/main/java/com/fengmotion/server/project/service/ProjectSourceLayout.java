package com.fengmotion.server.project.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;

public final class ProjectSourceLayout {
    private static final List<String> BASE = List.of("src", "public", "film.config.json", "package.json");
    private static final List<String> DIRECTORIES = List.of("components", "scenes", "styles", "assets");
    private static final List<String> STATE = List.of("project.json", "creation-state.json", "recovery.json", "package-lock.json");
    private ProjectSourceLayout() { }

    public static List<Path> files(Path root) throws IOException {
        List<Path> files = new ArrayList<>();
        for (String name : entries(root)) {
            Path entry = root.resolve(name);
            if (!Files.exists(entry, LinkOption.NOFOLLOW_LINKS)) continue;
            try (var paths = Files.walk(entry)) {
                for (Path file : paths.toList()) {
                    if (Files.isSymbolicLink(file)) throw new IOException("源码不能包含符号链接");
                    if (Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) files.add(file);
                    else if (!Files.isDirectory(file, LinkOption.NOFOLLOW_LINKS)) throw new IOException("源码包含特殊文件");
                }
            }
        }
        files.sort(Comparator.naturalOrder());
        return List.copyOf(files);
    }

    static boolean hasExtendedEntries(Path... roots) throws IOException {
        return entries(roots).stream().anyMatch(name -> !BASE.contains(name));
    }

    public static boolean contains(Path relative) {
        if (relative.isAbsolute() || relative.getNameCount() == 0 || !relative.normalize().equals(relative)) return false;
        String first = relative.getName(0).toString();
        if (first.equals(".") || first.equals("..")) return false;
        return relative.getNameCount() == 1 ? allowed(first)
                : first.equals("src") || first.equals("public") || DIRECTORIES.contains(first);
    }

    static List<String> entries(Path... roots) throws IOException {
        var entries = new LinkedHashSet<>(BASE);
        for (Path root : roots) {
            if (!Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) continue;
            try (var files = Files.list(root)) {
                for (Path file : files.sorted().toList()) {
                    String name = file.getFileName().toString();
                    if (allowed(name) && (Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)
                            || Files.isSymbolicLink(file) || DIRECTORIES.contains(name))) entries.add(name);
                }
            }
        }
        return List.copyOf(entries);
    }

    static boolean allowed(String name) {
        return BASE.contains(name) || DIRECTORIES.contains(name)
                || !name.startsWith(".") && !STATE.contains(name) && name.matches("[^/\\\\]+\\.(tsx|ts|jsx|js|mjs|cjs|css|json)");
    }
}
