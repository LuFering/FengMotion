package com.fengmotion.server.project.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.List;
import java.util.function.BooleanSupplier;
import org.springframework.http.HttpStatus;
import com.fengmotion.server.common.ApiException;

public final class SourceEditSession implements AutoCloseable {
    private final ProjectSourceSnapshots snapshots;
    private final Path root;
    private final String expected;
    private final String baseline;
    private final ProjectSourceSnapshots.Workspace workspace;
    private boolean applied;

    public static SourceEditSession open(ProjectSourceSnapshots snapshots, Path root, String expected) {
        SourceWriteGuard.requireRecovered(root);
        String hash = expected == null ? ProjectWorktreeService.fingerprint(root) : expected;
        String baseline = snapshots.captureVerified(root, hash);
        ProjectSourceSnapshots.Workspace workspace = null;
        try {
            workspace = snapshots.createWorkspace(root, baseline, hash);
            for (String name : List.of("prompt.original.md", "corrections.md", "AGENTS.md", "skill-guide.md", "decisions.md", "lookdev-brief.md", "film-plan.md", "quality-bar.md")) {
                Path source = root.resolve(name);
                if (Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS) && Files.size(source) <= 1_048_576) Files.copy(source, workspace.path().resolve(name));
            }
            return new SourceEditSession(snapshots, root, hash, baseline, workspace);
        } catch (IOException | RuntimeException failure) {
            if (workspace != null) workspace.close();
            snapshots.discard(root, baseline);
            if (failure instanceof RuntimeException runtime) throw runtime;
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_workspace_failed", "无法准备源码候选副本");
        }
    }

    private SourceEditSession(ProjectSourceSnapshots snapshots, Path root, String expected, String baseline, ProjectSourceSnapshots.Workspace workspace) {
        this.snapshots = snapshots;
        this.root = root;
        this.expected = expected;
        this.baseline = baseline;
        this.workspace = workspace;
    }

    public Path path() { return workspace.path(); }
    public String beforeHash() { return expected; }

    public String apply(BooleanSupplier cancelled) {
        if (applied) throw new IllegalStateException("候选已应用");
        requireRunning(cancelled);
        String hash = ProjectWorktreeService.fingerprint(path());
        if (hash.equals(expected)) {
            if (!expected.equals(ProjectWorktreeService.fingerprint(root))) throw new ApiException(HttpStatus.CONFLICT,
                    "source_changed", "执行期间工作稿已变化，未将旧候选当作当前结果");
            applied = true;
            return hash;
        }
        String candidate = snapshots.capture(root, path());
        try (var guard = SourceWriteGuard.acquire(root)) {
            requireRunning(cancelled);
            if (!expected.equals(ProjectWorktreeService.fingerprint(root))) {
                throw new ApiException(HttpStatus.CONFLICT, "source_changed", "执行期间工作稿已变化，候选未应用，请重新核对");
            }
            try (var recovery = snapshots.restore(root, candidate, hash)) {
                requireRunning(cancelled);
                if (!hash.equals(ProjectWorktreeService.fingerprint(root))) throw new ApiException(HttpStatus.CONFLICT, "source_changed", "候选应用期间源码变化，已尝试恢复原稿");
                recovery.commitAndDiscardBackup();
                applied = true;
                return hash;
            }
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_write_failed", "无法完成候选写回，请核对工程及恢复备份");
        } finally { snapshots.discard(root, candidate); }
    }

    private static void requireRunning(BooleanSupplier cancelled) {
        if (Thread.currentThread().isInterrupted() || cancelled.getAsBoolean()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "creation_cancelled", "执行已中断，候选未应用");
        }
    }

    @Override public void close() {
        workspace.close();
        snapshots.discard(root, baseline);
    }
}
