package com.fengmotion.server.workflow.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fengmotion.server.common.ApiException;

/** 工程版本保存实际代码与素材副本，恢复失败时保留并还原原工作目录。 */
@Component
public class ProjectSourceSnapshots {
    private static final Path DIRECTORY = Path.of(".fengmotion", "source-snapshots");
    private static final List<String> ENTRIES = List.of("src", "public", "film.config.json", "package.json");

    public String capture(Path root) {
        Path target = root.resolve(DIRECTORY).resolve(UUID.randomUUID().toString());
        try {
            if (Files.isSymbolicLink(root.resolve(".fengmotion")) || Files.isSymbolicLink(root.resolve(DIRECTORY))) {
                throw new IOException("快照目录不能是符号链接");
            }
            Files.createDirectories(target);
            for (String name : ENTRIES) {
                Path source = root.resolve(name);
                if (Files.exists(source, LinkOption.NOFOLLOW_LINKS)) copy(source, target.resolve(name));
            }
            String hash = CreateAgentRunner.sourceFingerprint(target);
            if (hash.startsWith("error:")) throw new IOException("工程指纹读取失败");
            Files.writeString(target.resolve("source.sha256"), hash);
            return root.relativize(target).toString().replace('\\', '/');
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_snapshot_failed",
                    "无法保存工程快照：" + failure.getMessage());
        }
    }

    public Path resolve(Path root, String relative) {
        Path base = root.resolve(DIRECTORY).toAbsolutePath().normalize();
        Path source = root.resolve(relative).toAbsolutePath().normalize();
        if (!base.equals(source.getParent()) || !Files.isDirectory(source, LinkOption.NOFOLLOW_LINKS)
                || Files.isSymbolicLink(base) || Files.isSymbolicLink(source)
                || Files.isSymbolicLink(root.resolve(".fengmotion"))) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "snapshot_corrupt", "工程快照路径无效或已丢失");
        }
        try {
            String expected = Files.readString(source.resolve("source.sha256"));
            if (!expected.equals(CreateAgentRunner.sourceFingerprint(source))) throw new IOException("内容校验不一致");
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "snapshot_corrupt", "工程快照不可用：" + failure.getMessage());
        }
        return source;
    }

    public Recovery restore(Path root, String relative, String expectedHash) {
        Path source = resolve(root, relative);
        if (expectedHash == null || !expectedHash.equals(CreateAgentRunner.sourceFingerprint(source))) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "snapshot_corrupt", "工程快照与该版本记录的内容不一致");
        }
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
