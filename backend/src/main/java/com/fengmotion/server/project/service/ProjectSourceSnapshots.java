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
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import lombok.extern.slf4j.Slf4j;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fengmotion.server.common.ApiException;

/** 工程版本保存实际代码与素材副本，恢复失败时保留并还原原工作目录。 */
@Component
@Slf4j
public class ProjectSourceSnapshots {
    private static final Path DIRECTORY = Path.of(".fengmotion", "source-snapshots");
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String LAYOUT_MARKER = ".source-layout";
    static final int MAX_RECOVERY_BYTES = 1_048_576;

    public String capture(Path root) {
        return capture(root, root);
    }

    public String captureVerified(Path root, String expectedHash) {
        if (!expectedHash.equals(ProjectWorktreeService.fingerprint(root))) throw sourceChanged();
        String reference = capture(root);
        try {
            Path saved = resolve(root, reference);
            if (!expectedHash.equals(ProjectWorktreeService.fingerprint(saved))
                    || !expectedHash.equals(ProjectWorktreeService.fingerprint(root))) throw sourceChanged();
            return reference;
        } catch (RuntimeException failure) {
            discard(root, reference);
            throw failure;
        }
    }

    private static ApiException sourceChanged() {
        return new ApiException(HttpStatus.CONFLICT, "source_changed", "工作稿在准备快照时发生变化，请重新核对后出片");
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
            for (String name : ProjectSourceLayout.entries(sourceRoot)) {
                Path source = sourceRoot.resolve(name);
                if (Files.exists(source, LinkOption.NOFOLLOW_LINKS)) copy(source, target.resolve(name));
            }
            String hash = ProjectSourceFingerprint.compute(target);
            if (hash.startsWith("error:")) throw new IOException("工程指纹读取失败");
            Files.writeString(target.resolve("source.sha256"), hash);
            Files.writeString(target.resolve(LAYOUT_MARKER), "2");
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
                for (String name : ProjectSourceLayout.entries(source)) {
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
        Path reference;
        try {
            if(relative==null || relative.isBlank()) throw new IllegalArgumentException();
            reference=Path.of(relative);
        } catch(IllegalArgumentException invalid) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"snapshot_corrupt","工程快照引用无效");
        }
        Path source = root.resolve(reference).toAbsolutePath().normalize();
        if (reference.isAbsolute() || !base.equals(source.getParent()) || !Files.isDirectory(source, LinkOption.NOFOLLOW_LINKS)
                || Files.isSymbolicLink(base) || Files.isSymbolicLink(source)
                || Files.isSymbolicLink(root.resolve(".fengmotion"))) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "snapshot_corrupt", "工程快照路径无效或已丢失");
        }
        try {
            Path layout = source.resolve(LAYOUT_MARKER);
            if (Files.exists(layout, LinkOption.NOFOLLOW_LINKS)
                    && (!Files.isRegularFile(layout, LinkOption.NOFOLLOW_LINKS) || Files.size(layout) != 1
                    || !"2".equals(Files.readString(layout)))) throw new IOException("不支持的源码快照范围版本");
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
        try {
            if (!Files.exists(source.resolve(LAYOUT_MARKER), LinkOption.NOFOLLOW_LINKS)
                    && ProjectSourceLayout.hasExtendedEntries(root, source)) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "source_snapshot_scope_unknown",
                        "旧快照未记录根目录源码的备份范围，无法安全恢复；已保留工作稿，可继续预览旧版或先备份迁移");
            }
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "snapshot_corrupt", "无法核对旧快照的恢复范围");
        }
        if (Files.isSymbolicLink(root.resolve(".fengmotion").resolve("restore-backups"))) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "snapshot_corrupt", "恢复备份目录不能是符号链接");
        }
        Recovery recovery = new Recovery(root, root.resolve(".fengmotion").resolve("restore-backups").resolve(UUID.randomUUID().toString()));
        try {
            var sourceEntries=ProjectSourceLayout.entries(root,source);
            Files.createDirectories(recovery.backup);
            // 先复制到暂存区，源快照读失败时不碰当前工程。
            Path staged = recovery.backup.resolve("staged");
            Files.createDirectories(staged);
            for (String name : sourceEntries) if (Files.exists(source.resolve(name), LinkOption.NOFOLLOW_LINKS)) copy(source.resolve(name), staged.resolve(name));
            Path original = recovery.backup.resolve("original");
            Files.createDirectory(original);
            for (String name : sourceEntries) if (Files.exists(root.resolve(name), LinkOption.NOFOLLOW_LINKS)) copy(root.resolve(name), original.resolve(name));
            String beforeHash = ProjectWorktreeService.fingerprint(original);
            if (!beforeHash.equals(ProjectWorktreeService.fingerprint(root))
                    || !expectedHash.equals(ProjectWorktreeService.fingerprint(staged))) {
                throw new ApiException(HttpStatus.CONFLICT, "source_changed", "准备恢复时工程或快照已变化，未替换工作稿");
            }
            recovery.journal = JSON.createObjectNode().put("state", "prepared").put("pid", ProcessHandle.current().pid())
                    .put("beforeHash", beforeHash).put("afterHash", expectedHash);
            ObjectNode entries = recovery.journal.putObject("entries");
            for (String name : sourceEntries) entries.putObject(name)
                    .put("before",SourceEntryFingerprint.compute(original.resolve(name)))
                    .put("after",SourceEntryFingerprint.compute(staged.resolve(name)));
            recovery.persist("prepared");
            for (String name : sourceEntries) {
                if (!SourceEntryFingerprint.compute(root.resolve(name)).equals(entries.path(name).path("before").asText())) {
                    throw new ApiException(HttpStatus.CONFLICT, "source_changed", "恢复期间发现外部修改，未继续替换工作稿");
                }
                recovery.journal.put("replacing",name);
                recovery.persist("prepared");
                Path current = root.resolve(name);
                if (Files.exists(current, LinkOption.NOFOLLOW_LINKS)) Files.move(current, recovery.backup.resolve(name));
                recovery.moved.add(name);
                if (Files.exists(staged.resolve(name), LinkOption.NOFOLLOW_LINKS)) Files.move(staged.resolve(name), current);
                recovery.installed.add(name);
            }
            if (!expectedHash.equals(ProjectWorktreeService.fingerprint(root))) throw new ApiException(HttpStatus.CONFLICT,
                    "source_changed", "恢复结果与快照不一致，已尝试还原原工作稿");
            recovery.journal.remove("replacing");
            recovery.persist("applied");
            return recovery;
        } catch (IOException | RuntimeException failure) {
            try { recovery.close(); } catch (IOException rollback) { failure.addSuppressed(rollback); }
            if (failure instanceof RuntimeException runtime) throw runtime;
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
            if(!Files.isRegularFile(source,LinkOption.NOFOLLOW_LINKS)) throw new IOException("工程中存在特殊文件："+source);
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
        private final java.util.Set<String> installed = new java.util.HashSet<>();
        private boolean committed;
        private ObjectNode journal;

        private Recovery(Path root, Path backup) { this.root = root; this.backup = backup; }
        private void persist(String state) throws IOException {
            if (journal == null) return;
            journal.put("state", state);
            Path temporary = backup.resolve("recovery.json.tmp");
            byte[] content = journal.toString().getBytes(StandardCharsets.UTF_8);
            if (content.length > MAX_RECOVERY_BYTES) throw new IOException("恢复日志超出容量，未继续替换源码");
            Files.write(temporary, content);
            Files.move(temporary, backup.resolve("recovery.json"), java.nio.file.StandardCopyOption.ATOMIC_MOVE,
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }

        public void commit() {
            committed = true;
            try { persist("committed"); }
            catch (IOException failure) { log.error("工程已提交，但恢复日志未收尾：{}", backup, failure); }
        }

        public void retainPending() { committed=true; }

        public void commitAndDiscardBackup() {
            commit();
            try { deleteTree(backup); }
            catch (IOException | UncheckedIOException failure) { log.warn("工作稿已应用，但备份清理失败：{}", backup, failure); }
        }

        @Override public void close() throws IOException {
            if (committed) return;
            IOException failure = null;
            for (String name : moved.reversed()) {
                try {
                    Path current = root.resolve(name);
                    if (journal != null && Files.exists(current, LinkOption.NOFOLLOW_LINKS)
                            && !SourceEntryFingerprint.compute(current).equals(journal.path("entries").path(name).path("after").asText())) {
                        throw new IOException("回滚前源码已被外部修改，保留现场：" + name);
                    }
                    if (journal != null && installed.contains(name) && !Files.exists(current, LinkOption.NOFOLLOW_LINKS)
                            && !"missing".equals(journal.path("entries").path(name).path("after").asText())) {
                        throw new IOException("回滚前源码已被外部删除，保留现场：" + name);
                    }
                    if (Files.exists(current, LinkOption.NOFOLLOW_LINKS)) Files.move(current, backup.resolve("uncommitted-" + name));
                    if (Files.exists(backup.resolve(name), LinkOption.NOFOLLOW_LINKS)) Files.move(backup.resolve(name), current);
                } catch (IOException problem) {
                    if (failure == null) failure = problem; else failure.addSuppressed(problem);
                }
            }
            if (failure != null) throw failure;
            persist("rolled_back");
        }
    }
}
