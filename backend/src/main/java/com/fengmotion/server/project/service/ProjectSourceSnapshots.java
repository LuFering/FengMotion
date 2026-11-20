package com.fengmotion.server.project.service;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import lombok.extern.slf4j.Slf4j;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fengmotion.server.common.ApiException;

/** 工程版本保存实际代码与素材副本，恢复失败时保留并还原原工作目录。 */
@Component
@Slf4j
public class ProjectSourceSnapshots {
    private static final Path DIRECTORY = Path.of(".fengmotion", "source-snapshots");
    private static final List<String> ENTRIES = List.of("src", "public", "film.config.json", "package.json");

    public String capture(Path root) {
        return capture(root, root);
    }

    public String capture(Path root, Path sourceRoot) {
        Path target = root.resolve(DIRECTORY).resolve(UUID.randomUUID().toString());
        boolean created = false;
        try {
            if (Files.isSymbolicLink(root.resolve(".fengmotion")) || Files.isSymbolicLink(root.resolve(DIRECTORY))) {
                throw new IOException("快照目录不能是符号链接");
            }
            Files.createDirectories(target.getParent());
            Files.createDirectory(target);
            created = true;
            for (String name : ENTRIES) {
                Path source = sourceRoot.resolve(name);
                if (Files.exists(source, LinkOption.NOFOLLOW_LINKS)) copy(source, target.resolve(name));
            }
            String hash = ProjectSourceFingerprint.compute(target);
            if (hash.startsWith("error:")) throw new IOException("工程指纹读取失败");
            Files.writeString(target.resolve("source.sha256"), hash);
            return root.relativize(target).toString().replace('\\', '/');
        } catch (IOException failure) {
            if (created) discard(root, root.relativize(target).toString());
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_snapshot_failed",
                    "无法保存工程快照：" + failure.getMessage());
        }
    }

    public Workspace createWorkspace(Path root, String relative, String versionHash) {
        Path source = resolve(root, relative, versionHash);
        try {
            Path workspace = Files.createTempDirectory("fengmotion-scene-edit-");
            try {
                for (String name : ENTRIES) {
                    Path entry = source.resolve(name);
                    if (Files.exists(entry, LinkOption.NOFOLLOW_LINKS)) copy(entry, workspace.resolve(name));
                }
                String actual = ProjectSourceFingerprint.compute(workspace);
                if (!versionHash.equals(actual)) throw new IOException("隔离工作区与版本快照不一致");
                return new Workspace(workspace);
            } catch (IOException | RuntimeException failure) {
                new Workspace(workspace).close();
                throw failure;
            }
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_workspace_failed",
                    "无法准备元素编辑工作区：" + failure.getMessage());
        }
    }

    public void discard(Path root, String relative) {
        if (Files.isSymbolicLink(root.resolve(".fengmotion")) || Files.isSymbolicLink(root.resolve(DIRECTORY))) return;
        Path base = root.resolve(DIRECTORY).toAbsolutePath().normalize();
        Path reference;
        try {
            reference = Path.of(relative);
        } catch (RuntimeException invalid) {
            return;
        }
        Path snapshot = root.resolve(reference).toAbsolutePath().normalize();
        if (reference.isAbsolute() || !base.equals(snapshot.getParent()) || Files.isSymbolicLink(snapshot)) return;
        try {
            deleteTree(snapshot);
        } catch (IOException | UncheckedIOException failure) {
            log.warn("未提交的工程快照清理失败：{}", snapshot, failure);
        }
    }

    private static void deleteTree(Path root) throws IOException {
        if (root == null || Files.notExists(root, LinkOption.NOFOLLOW_LINKS)) return;
        try (var paths = Files.walk(root)) {
            for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
        }
    }

    public Path resolve(Path root, String relative) {
        return resolve(root, relative, null);
    }

    public Path resolve(Path root, String relative, String versionHash) {
        Path base = root.resolve(DIRECTORY).toAbsolutePath().normalize();
        Path reference = Path.of(relative);
        Path source = root.resolve(reference).toAbsolutePath().normalize();
        if (reference.isAbsolute() || !base.equals(source.getParent()) || !Files.isDirectory(source, LinkOption.NOFOLLOW_LINKS)
                || Files.isSymbolicLink(base) || Files.isSymbolicLink(source)
                || Files.isSymbolicLink(root.resolve(".fengmotion"))) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "snapshot_corrupt", "工程快照路径无效或已丢失");
        }
        try {
            Path marker = source.resolve("source.sha256");
            if (!Files.isRegularFile(marker, LinkOption.NOFOLLOW_LINKS)) throw new IOException("缺少快照指纹");
            String expected;
            try (var input = Files.newInputStream(marker, LinkOption.NOFOLLOW_LINKS)) {
                byte[] content = input.readNBytes(129);
                if (content.length > 128) throw new IOException("快照指纹无效");
                expected = new String(content, StandardCharsets.UTF_8);
            }
            if (versionHash != null && !versionHash.equals(expected)) {
                throw new IOException("工程快照与该版本记录的内容不一致");
            }
            try (var files = Files.walk(source)) {
                if (files.anyMatch(Files::isSymbolicLink)) throw new IOException("工程快照不能包含符号链接");
            }
            String actual = ProjectSourceFingerprint.compute(source);
            if (actual.startsWith("error:") || !expected.equals(actual)) throw new IOException("内容校验不一致");
        } catch (IOException | UncheckedIOException failure) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "snapshot_corrupt", "工程快照不可用：" + failure.getMessage());
        }
        return source;
    }

    public Recovery restore(Path root, String relative, String expectedHash) {
        if (expectedHash == null || expectedHash.isBlank()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "snapshot_corrupt", "工程快照与该版本记录的内容不一致");
        }
        Path source = resolve(root, relative, expectedHash);
        if (Files.isSymbolicLink(root.resolve(".fengmotion").resolve("restore-backups"))) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "snapshot_corrupt", "恢复备份目录不能是符号链接");
        }
        Recovery recovery = new Recovery(root, root.resolve(".fengmotion").resolve("restore-backups").resolve(UUID.randomUUID().toString()));
        try {
            Files.createDirectories(recovery.backup);
            // 先复制到暂存区，源快照读失败时不碰当前工程。
            Path staged = recovery.backup.resolve("staged");
            Files.createDirectories(staged);
            for (String name : ENTRIES) if (Files.exists(source.resolve(name), LinkOption.NOFOLLOW_LINKS)) copy(source.resolve(name), staged.resolve(name));
            for (String name : ENTRIES) {
                Path current = root.resolve(name);
                if (Files.exists(current, LinkOption.NOFOLLOW_LINKS)) Files.move(current, recovery.backup.resolve(name));
                recovery.moved.add(name);
                if (Files.exists(staged.resolve(name), LinkOption.NOFOLLOW_LINKS)) Files.move(staged.resolve(name), current);
            }
            return recovery;
        } catch (IOException failure) {
            try { recovery.close(); } catch (IOException rollback) { failure.addSuppressed(rollback); }
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_restore_failed",
                    "工程恢复未完成；原文件保存在 " + recovery.backup + "：" + failure.getMessage());
        }
    }

    private void copy(Path source, Path destination) throws IOException {
        if (Files.isSymbolicLink(source)) throw new IOException("工程中存在符号链接，无法创建独立快照：" + source);
        if (Files.isDirectory(source, LinkOption.NOFOLLOW_LINKS)) {
            Files.createDirectories(destination);
            try (var children = Files.list(source)) {
                for (Path child : children.toList()) copy(child, destination.resolve(child.getFileName()));
            }
        } else {
            Files.copy(source, destination);
        }
    }

    public static final class Workspace implements AutoCloseable {
        private final Path path;

        private Workspace(Path path) { this.path = path; }

        public Path path() { return path; }

        @Override public void close() {
            try {
                deleteTree(path);
            } catch (IOException | UncheckedIOException failure) {
                log.warn("元素编辑临时工作区清理失败：{}", path, failure);
            }
        }
    }

    /** 数据库提交失败则把本次恢复内容移到旁边，再原样放回动手前的工程。 */
    public static final class Recovery implements AutoCloseable {
        private final Path root;
        private final Path backup;
        private final List<String> moved = new ArrayList<>();
        private boolean committed;

        private Recovery(Path root, Path backup) { this.root = root; this.backup = backup; }
        public void commit() { committed = true; }

        @Override public void close() throws IOException {
            if (committed) return;
            IOException failure = null;
            for (String name : moved.reversed()) {
                try {
                    Path current = root.resolve(name);
                    if (Files.exists(current, LinkOption.NOFOLLOW_LINKS)) Files.move(current, backup.resolve("uncommitted-" + name));
                    if (Files.exists(backup.resolve(name), LinkOption.NOFOLLOW_LINKS)) Files.move(backup.resolve(name), current);
                } catch (IOException problem) {
                    if (failure == null) failure = problem; else failure.addSuppressed(problem);
                }
            }
            if (failure != null) throw failure;
        }
    }
}
