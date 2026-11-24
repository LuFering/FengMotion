package com.fengmotion.server.project.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import com.fengmotion.server.common.ApiException;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public final class SourceWriteGuard implements AutoCloseable {
    private final Path lock;
    private final String owner;

    private SourceWriteGuard(Path lock, String owner) { this.lock = lock; this.owner = owner; }

    public static SourceWriteGuard acquire(Path root) {
        if(Files.exists(root.resolve(".fengmotion/source-write.lock"),LinkOption.NOFOLLOW_LINKS)) throw busy();
        var guard=acquireForRecovery(root);
        try { requireRecovered(root);return guard; }
        catch(RuntimeException failure) { guard.close();throw failure; }
    }

    public static void requireRecovered(Path root) {
        Path base=root.resolve(".fengmotion/restore-backups");
        if(Files.isSymbolicLink(root.resolve(".fengmotion")) || Files.isSymbolicLink(base)) throw busy();
        if(!Files.isDirectory(base,LinkOption.NOFOLLOW_LINKS)) return;
        try(var entries=Files.list(base)) {
            var json=new com.fasterxml.jackson.databind.ObjectMapper();
            for(Path entry:entries.toList()) {
                Path journal=entry.resolve("recovery.json");
                if(Files.isSymbolicLink(entry) || Files.isSymbolicLink(journal)) throw busy();
                if(!Files.exists(journal,LinkOption.NOFOLLOW_LINKS)) continue;
                if (!Files.isRegularFile(journal, LinkOption.NOFOLLOW_LINKS)
                        || Files.size(journal) > ProjectSourceSnapshots.MAX_RECOVERY_BYTES) throw busy();
                var value=json.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY,
                        com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(Files.readString(journal));
                if(value==null || !value.isObject()) throw new IOException("invalid recovery journal");
                var state=value.path("state").asText();
                if(!java.util.List.of("committed","rolled_back").contains(state)) {
                    throw new ApiException(HttpStatus.CONFLICT,"source_recovery_required","工程存在未收尾的源码写入，请先检查并恢复工作稿");
                }
            }
        } catch(IOException failure) { throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"source_recovery_invalid","无法核对工程恢复记录"); }
    }

    static SourceWriteGuard acquireForRecovery(Path root) {
        Path control = root.resolve(".fengmotion");
        Path lock = control.resolve("source-write.lock");
        String token = UUID.randomUUID().toString();
        Path staged = control.resolve(".source-lock-" + token);
        String owner = "{\"pid\":" + ProcessHandle.current().pid() + ",\"token\":\"" + token + "\"}";
        try {
            if (Files.isSymbolicLink(control) || Files.isSymbolicLink(lock)) throw new IOException("invalid lock path");
            Files.createDirectories(control);
            Files.createDirectory(staged);
            Files.writeString(staged.resolve("owner.json"), owner);
            if (Files.exists(lock, LinkOption.NOFOLLOW_LINKS)) throw busy();
            try { Files.move(staged, lock); }
            catch (IOException occupied) { if (Files.exists(lock, LinkOption.NOFOLLOW_LINKS)) throw busy(); else throw occupied; }
            return new SourceWriteGuard(lock, owner);
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "source_lock_invalid", "无法取得源码写入锁");
        } finally {
            try { Files.deleteIfExists(staged.resolve("owner.json")); Files.deleteIfExists(staged); }
            catch (IOException ignored) { }
        }
    }

    private static ApiException busy() {
        return new ApiException(HttpStatus.CONFLICT, "source_busy", "另一处正在写入源码，请重新读取后重试；中断遗留锁需核对后清理");
    }

    @Override public void close() {
        try {
            Path marker = lock.resolve("owner.json");
            if (!Files.isSymbolicLink(lock) && Files.isRegularFile(marker, LinkOption.NOFOLLOW_LINKS)
                    && Files.size(marker) < 1024 && owner.equals(Files.readString(marker))) {
                Files.delete(marker);
                Files.delete(lock);
            }
        } catch (IOException failure) { log.warn("源码写入锁清理失败：{}", lock); }
    }
}
