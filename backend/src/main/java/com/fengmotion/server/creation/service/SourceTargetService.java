package com.fengmotion.server.creation.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.creation.domain.CreateRequest;
import com.fengmotion.server.project.domain.SourceTarget;
import com.fengmotion.server.project.service.ProjectSourceSnapshots;
import com.fengmotion.server.project.service.ProjectSourceLayout;
import com.fengmotion.server.project.service.ProjectWorktreeService;
import com.fengmotion.server.project.service.SourceWriteGuard;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.render.service.SourceTargetInspector;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class SourceTargetService {
    private final ProjectRepository projects;
    private final ProjectWorktreeService worktrees;
    private final SourceTargetInspector inspector;
    private final ProjectSourceSnapshots snapshots;

    public Resolved resolve(String projectId, Selection selection) {
        if (selection == null || selection.src() == null || selection.fileHash() == null) throw invalid();
        var match = java.util.regex.Pattern.compile("^(.+):(\\d+):(\\d+)$").matcher(selection.src());
        if (!match.matches()) throw invalid();
        int line;
        int column;
        try { line = Integer.parseInt(match.group(2)); column = Integer.parseInt(match.group(3)); }
        catch (NumberFormatException failure) { throw invalid(); }
        Path root = root(projectId);
        SourceWriteGuard.requireRecovered(root);
        var state = worktrees.read(projectId);
        var selected = new SourceTarget(match.group(1), line, column, selection.fileHash(), null);
        Verified verified = verify(root, selected, false);
        if (!state.sourceHash().equals(ProjectWorktreeService.fingerprint(root))) throw changed();
        return new Resolved(projectId, state.version(), state.sourceHash(), new SourceTarget(selected.file(),
                line, column, digest(verified.content(), "SHA-256"), verified.span().code()));
    }

    public void validate(Path root, SourceTarget target) { verify(root, target, true); }

    public CreateAgentRunner.AgentOutcome run(Path root, CreateRequest request, String instruction,
            ResourceContextBuilder.ResourceContext resources, CreateAgentRunner agent, String projectId) {
        SourceWriteGuard.requireRecovered(root);
        Verified original = verify(root, request.target(), true);
        String expected = request.sourceHash();
        String baseline = snapshots.captureVerified(root, expected);
        try (var workspace = snapshots.createWorkspace(root, baseline, expected)) {
            copyContext(root, workspace.path());
            String task = instruction + "\n\n精确修改目标：" + request.target().file() + ":" + request.target().line()
                    + ":" + request.target().column() + "\n只允许重写下面这一段 JSX，其他源码、导入、全局样式与素材保持原样。"
                    + "可自由调整此 JSX 的内部结构、表达式和属性；如果需要扩大范围请说明原因而不要修改其他位置。\n"
                    + "<selected-jsx>\n" + request.target().code() + "\n</selected-jsx>";
            var outcome = agent.run(workspace.path(), task, resources, request.previewImage(), projectId,
                    request.sessionId(), request.requestId(), request.engineSelection());
            CreationCancellation.requireRunning();
            Path candidate = file(workspace.path(), request.target().file());
            String edited = read(candidate);
            String prefix = original.content().substring(0, original.span().start());
            String suffix = original.content().substring(original.span().end());
            if (edited.length() < prefix.length() + suffix.length() || !edited.startsWith(prefix) || !edited.endsWith(suffix)) throw outOfScope();
            inspector.validate(edited);
            Files.writeString(candidate, original.content());
            if (!expected.equals(ProjectWorktreeService.fingerprint(workspace.path()))) throw outOfScope();
            boolean changed = !original.content().equals(edited);
            if (changed) {
                Files.writeString(candidate,edited);
                String updatedHash=ProjectWorktreeService.fingerprint(workspace.path());
                String updated=snapshots.capture(root,workspace.path());
                try {
                try (var guard = SourceWriteGuard.acquire(root)) {
                    CreationCancellation.requireRunning();
                    if (!expected.equals(ProjectWorktreeService.fingerprint(root))) throw changed();
                    verify(root, request.target(), true);
                    try(var recovery=snapshots.restore(root,updated,updatedHash)) {
                        CreationCancellation.requireRunning();
                        recovery.commitAndDiscardBackup();
                    }
                }
                } finally { snapshots.discard(root,updated); }
            }
            return new CreateAgentRunner.AgentOutcome(outcome.reply(), outcome.elapsedMs(), outcome.hasEntry(),
                    outcome.hasConfig(), changed, expected, ProjectWorktreeService.fingerprint(root));
        } catch (IOException failure) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "source_write_failed", "目标修改未能保存，工作稿请重新核对");
        } finally { snapshots.discard(root, baseline); }
    }

    private Verified verify(Path root, SourceTarget target, boolean requireCode) {
        if (target == null || target.line() < 1 || target.column() < 1 || target.fileHash() == null
                || !target.fileHash().matches("[0-9a-f]{16}|[0-9a-f]{40}|[0-9a-f]{64}")
                || (requireCode && target.fileHash().length() != 64)
                || (requireCode && (target.code() == null || target.code().isBlank() || target.code().length() > 32768))) throw invalid();
        String content = read(file(root, target.file()));
        String hash = digest(content, target.fileHash().length() == 64 ? "SHA-256" : "SHA-1");
        if (target.fileHash().length() == 16) hash = hash.substring(0, 16);
        if (!target.fileHash().equals(hash)) throw changed();
        var span = inspector.inspect(content, target.line(), target.column());
        if (requireCode && !target.code().equals(span.code())) throw changed();
        return new Verified(content, span);
    }

    private Path root(String projectId) {
        return ProjectWorktreeService.root(projects.findById(projectId).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "not_found", "项目不存在")));
    }

    private static Path file(Path root, String relative) {
        try {
            if (relative == null || !relative.matches(".+\\.(tsx|jsx)") || relative.contains("\\") || relative.contains(":")) throw invalid();
            Path reference = Path.of(relative);
            if (!ProjectSourceLayout.contains(reference)) throw invalid();
            Path current = root;
            for (Path part : reference) {
                if (List.of("..", ".", "node_modules", ".git", ".fengmotion").contains(part.toString())) throw invalid();
                current = current.resolve(part);
                if (Files.isSymbolicLink(current)) throw invalid();
            }
            if (!current.normalize().startsWith(root.normalize()) || !Files.isRegularFile(current, LinkOption.NOFOLLOW_LINKS)
                    || !current.toRealPath().startsWith(root.toRealPath())) throw invalid();
            return current;
        } catch (IOException | java.nio.file.InvalidPathException failure) { throw invalid(); }
    }

    private static String read(Path file) {
        try {
            if (Files.size(file) > 1_048_576) throw invalid();
            return Files.readString(file);
        } catch (IOException failure) { throw invalid(); }
    }

    private static String digest(String content, String algorithm) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance(algorithm).digest(content.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException failure) { throw new IllegalStateException(failure); }
    }

    private static void copyContext(Path root, Path target) throws IOException {
        for (String name : List.of("prompt.original.md", "corrections.md", "AGENTS.md", "skill-guide.md", "decisions.md", "lookdev-brief.md", "film-plan.md")) {
            Path source = root.resolve(name);
            if (Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS) && Files.size(source) <= 1_048_576) Files.copy(source, target.resolve(name));
        }
    }

    private static ApiException invalid() { return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "source_target_invalid", "源码目标必须是项目内有效的 JSX，并携带文件指纹"); }
    private static ApiException changed() { return new ApiException(HttpStatus.CONFLICT, "source_changed", "选中后的源码已变化，请重新选择目标后提交"); }
    private static ApiException outOfScope() { return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "source_target_out_of_scope", "AI 修改超出选中 JSX；候选未写回，请缩小修改或明确扩大范围"); }
    private record Verified(String content, SourceTargetInspector.Span span) { }
    public record Selection(String src, String fileHash) { }
    public record Resolved(String projectId, long baseVersion, String sourceHash, SourceTarget target) { }
}
