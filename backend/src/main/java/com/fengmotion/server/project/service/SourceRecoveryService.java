package com.fengmotion.server.project.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.store.ProjectSceneRepository;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class SourceRecoveryService {
    private final ProjectRepository projects;
    private final ProjectOperationLock operations;
    private final ProjectSourceSnapshots snapshots;
    private final ObjectMapper json;
    private final ProjectSceneRepository scenes;

    public Status inspect(String projectId) {
        try (var activity = operations.participate(projectId)) {
            Path root = root(projectId);
            Lock lock = lock(root);
            return new Status(ProjectWorktreeService.fingerprint(root), lock, journals(root));
        }
    }

    public Status recover(String projectId, Request request) {
        if (request == null || request.sourceHash() == null || !request.sourceHash().matches("files=\\d+;sha256=(?:[0-9a-f]{64}|empty)")) throw invalid();
        if(request.recoveryId()!=null && !request.recoveryId().matches("[0-9a-f-]{36}")) throw invalid();
        try (var maintenance = operations.beginDeletion(projectId)) {
            Path root = root(projectId);
            String currentHash=ProjectWorktreeService.fingerprint(root);
            if(completedRecovery(root,request,currentHash)) return new Status(currentHash,lock(root),journals(root));
            if (!request.sourceHash().equals(currentHash)) throw changed();
            Lock lock = lock(root);
            var pending=journals(root);
            if(pending.stream().anyMatch(item->item.ownerAlive() && !ownedByCurrent(root,item.id()))) throw busy();
            if(request.recoveryId()!=null && pending.stream().noneMatch(item->item.id().equals(request.recoveryId()))) throw invalid();
            if (lock != null) {
                if (lock.alive() || !lock.token().equals(request.lockToken())) throw busy();
                releaseAbandoned(root, lock);
            } else if (request.lockToken() != null) throw changed();
            try (var write = SourceWriteGuard.acquireForRecovery(root)) {
                if (!request.sourceHash().equals(ProjectWorktreeService.fingerprint(root))) throw changed();
                if (request.recoveryId() != null) rollback(projectId, root, request.recoveryId(), request.sourceHash());
                return new Status(ProjectWorktreeService.fingerprint(root), null, journals(root));
            }
        }
    }

    private boolean completedRecovery(Path root,Request request,String currentHash) {
        if(request.recoveryId()==null || lock(root)!=null) return false;
        Path directory=safe(root,"restore-backups").resolve(request.recoveryId());
        if(Files.isSymbolicLink(directory)) throw invalid();
        Path file=directory.resolve("recovery.json");
        if(!Files.exists(file,LinkOption.NOFOLLOW_LINKS)) return false;
        try {
            var journal=object(file);
            String state=journal.path("state").asText();
            if(!List.of("committed","rolled_back").contains(state)) return false;
            String expected=state.equals("committed")?journal.path("afterHash").asText():journal.path("beforeHash").asText();
            String originalRequest=journal.path("recoveryRequestHash").asText();
            return request.sourceHash().equals(originalRequest) && currentHash.equals(expected);
        } catch(IOException failure) { throw invalid(); }
    }

    private void rollback(String projectId, Path root, String id, String currentHash) {
        if (!id.matches("[0-9a-f-]{36}")) throw invalid();
        Path backup = safe(root, "restore-backups").resolve(id);
        var pending = journals(root).stream().filter(item -> item.id().equals(id)).findFirst().orElseThrow(SourceRecoveryService::invalid);
        if (!List.of("applied", "prepared").contains(pending.state()) || pending.ownerAlive() && !ownedByCurrent(root,id)) throw busy();
        if (Files.isSymbolicLink(backup) || Files.isSymbolicLink(backup.resolve("original"))) throw invalid();
        if (!pending.beforeHash().equals(ProjectWorktreeService.fingerprint(backup.resolve("original")))) throw invalid();
        ObjectNode journal;
        try {
            journal = object(backup.resolve("recovery.json"));
            if (!currentHash.equals(pending.afterHash()) && !currentHash.equals(pending.beforeHash())) {
                var names=new java.util.LinkedHashSet<>(ProjectSourceLayout.entries(root,backup.resolve("original"),backup.resolve("staged")));
                journal.path("entries").fieldNames().forEachRemaining(names::add);
                for (String name : names) {
                    if(!ProjectSourceLayout.allowed(name)) throw invalid();
                    String actual = SourceEntryFingerprint.compute(root.resolve(name));
                    var entry = journal.path("entries").path(name);
                    boolean interruptedMove=actual.equals("missing") && name.equals(journal.path("replacing").asText())
                            && SourceEntryFingerprint.compute(backup.resolve(name)).equals(entry.path("before").asText())
                            && SourceEntryFingerprint.compute(backup.resolve("staged").resolve(name)).equals(entry.path("after").asText());
                    if (!interruptedMove && !actual.equals(entry.path("before").asText()) && !actual.equals(entry.path("after").asText())) {
                        throw new ApiException(HttpStatus.CONFLICT,"recovery_manual_required","工作稿有恢复日志之外的修改，保留现场，拒绝自动覆盖");
                    }
                    if (!SourceEntryFingerprint.compute(backup.resolve("original").resolve(name)).equals(entry.path("before").asText())) throw invalid();
                }
            }
            var current = scenes.find(projectId).orElse(null);
            if (current != null && current.present() && pending.afterHash().equals(current.film().path("sourceHash").asText())) {
                if (!currentHash.equals(pending.afterHash())) {
                    String reference=current.film().path("sourceSnapshot").asText("");
                    if(reference.isBlank()) throw invalid();
                    try(var recovery=snapshots.restore(root,reference,pending.afterHash())) { recovery.commitAndDiscardBackup(); }
                }
                journal.put("state","committed");
                journal.put("recoveryRequestHash",currentHash);
                persist(backup,journal);
                return;
            }
        } catch (IOException failure) { throw invalid(); }
        String copied = snapshots.capture(root, backup.resolve("original"));
        try {
            if (!currentHash.equals(pending.beforeHash())) {
                try (var recovery = snapshots.restore(root, copied, pending.beforeHash())) { recovery.commitAndDiscardBackup(); }
            }
            journal.put("state", "rolled_back");
            journal.put("recoveryRequestHash",currentHash);
            persist(backup,journal);
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR,"source_recovery_failed","恢复未完成，请保留备份重新核对");
        } finally { snapshots.discard(root, copied); }
    }

    private static void persist(Path backup,ObjectNode journal) throws IOException {
        Path temporary = backup.resolve("recovery.json.tmp");
        Files.writeString(temporary,journal.toString());
        Files.move(temporary,backup.resolve("recovery.json"),java.nio.file.StandardCopyOption.ATOMIC_MOVE,java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }

    private void releaseAbandoned(Path root, Lock expected) {
        Path control = safe(root, "source-write.lock").getParent();
        Path lock = control.resolve("source-write.lock");
        Path quarantine = control.resolve("abandoned-lock-" + UUID.randomUUID());
        if (!expected.equals(lock(root))) throw changed();
        try {
            Files.move(lock, quarantine, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
            if (!expected.equals(readLock(quarantine))) {
                try { Files.move(quarantine, lock); } catch (IOException ignored) { }
                throw changed();
            }
        } catch (IOException failure) { throw changed(); }
    }

    private Lock lock(Path root) {
        Path path = safe(root, "source-write.lock");
        return Files.exists(path, LinkOption.NOFOLLOW_LINKS) ? readLock(path) : null;
    }

    private Lock readLock(Path path) {
        try {
            if (Files.isSymbolicLink(path)) throw invalid();
            var value = object(path.resolve("owner.json"));
            long pid = value.path("pid").asLong(-1);
            String token = value.path("token").asText();
            if (pid <= 0 || !token.matches("[0-9a-f-]{36}")) throw invalid();
            return new Lock(pid, token, alive(pid));
        } catch (IOException failure) { throw invalid(); }
    }

    private List<Journal> journals(Path root) {
        Path base = safe(root, "restore-backups");
        if (!Files.exists(base)) return List.of();
        List<Journal> found = new ArrayList<>();
        try (var paths = Files.list(base)) {
            for (Path entry : paths.toList()) {
                if (Files.isSymbolicLink(entry)) throw invalid();
                Path file = entry.resolve("recovery.json");
                if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) continue;
                var value = object(file);
                String state = value.path("state").asText();
                if (List.of("committed", "rolled_back").contains(state)) continue;
                long pid = value.path("pid").asLong(-1);
                found.add(new Journal(entry.getFileName().toString(),state,value.path("beforeHash").asText(),value.path("afterHash").asText(),pid <= 0 || alive(pid)));
            }
            return List.copyOf(found);
        } catch (IOException failure) { throw invalid(); }
    }

    private Path root(String id) { return ProjectWorktreeService.root(projects.findById(id).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND,"not_found","项目不存在"))); }
    private static Path safe(Path root, String name) {
        Path control = root.resolve(".fengmotion");
        Path child = control.resolve(name);
        if (Files.isSymbolicLink(control) || Files.isSymbolicLink(child)) throw invalid();
        return child;
    }
    private static String read(Path file) throws IOException {
        if (!Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS) || Files.size(file) > ProjectSourceSnapshots.MAX_RECOVERY_BYTES) throw invalid();
        return Files.readString(file);
    }

    private boolean ownedByCurrent(Path root,String id) {
        if(!id.matches("[0-9a-f-]{36}")) throw invalid();
        Path directory=safe(root,"restore-backups").resolve(id);
        if(Files.isSymbolicLink(directory)) throw invalid();
        try { return object(directory.resolve("recovery.json")).path("pid").asLong(-1)==ProcessHandle.current().pid(); }
        catch(IOException failure) { throw invalid(); }
    }

    private ObjectNode object(Path file) throws IOException {
        var value=json.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY,
                com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(read(file));
        if(value==null || !value.isObject()) throw invalid();
        return (ObjectNode)value;
    }
    private static boolean alive(long pid) {
        try { return ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false); }
        catch (SecurityException failure) { return true; }
    }
    private static ApiException invalid() { return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"source_recovery_invalid","恢复记录或写入锁无效，未自动覆盖工程"); }
    private static ApiException changed() { return new ApiException(HttpStatus.CONFLICT,"source_changed","工程或恢复记录已变化，请重新读取"); }
    private static ApiException busy() { return new ApiException(HttpStatus.CONFLICT,"source_busy","写入进程仍存活或锁身份不匹配，不能恢复"); }
    public record Lock(long pid,String token,boolean alive) { }
    public record Journal(String id,String state,String beforeHash,String afterHash,boolean ownerAlive) { }
    public record Status(String sourceHash,Lock lock,List<Journal> recoveries) { }
    public record Request(String sourceHash,String lockToken,String recoveryId) { }
}
