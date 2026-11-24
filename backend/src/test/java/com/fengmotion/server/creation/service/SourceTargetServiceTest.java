package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.creation.domain.CreateRequest;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.domain.SourceTarget;
import com.fengmotion.server.project.service.*;
import com.fengmotion.server.project.store.*;
import com.fengmotion.server.render.service.SourceTargetInspector;

class SourceTargetServiceTest {
    @TempDir Path root;
    private final String original = "export const Title = () => <h1 style={{fontSize: 60}}>Coffee</h1>;\nexport const End = () => <div>Keep outro</div>;\n";
    private final CreateAgentRunner agent = mock(CreateAgentRunner.class);
    private SourceTargetService targets;
    private SourceTargetService.Resolved selected;
    private ProjectWorktreeService worktrees;

    @BeforeEach void setup() throws Exception {
        Path modules = Path.of("../frontend/node_modules").toAbsolutePath().normalize();
        Assumptions.assumeTrue(Files.isDirectory(modules.resolve("@babel/parser")));
        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"), original);
        Files.writeString(root.resolve("film.config.json"), "{\"entry\":\"src/index.tsx\",\"compositionId\":\"Main\"}");
        Files.writeString(root.resolve("prompt.original.md"), "Make a short coffee video");
        var projects = mock(ProjectRepository.class);
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project", "Coffee", null, null, root.toString(), Instant.now())));
        worktrees = new ProjectWorktreeService(projects, mock(ProjectSceneRepository.class), new ProjectOperationLock());
        targets = new SourceTargetService(projects, worktrees, new SourceTargetInspector(new ObjectMapper(),
                Path.of("remotion").toAbsolutePath().toString(), modules.toString(), "node"), new ProjectSourceSnapshots());
        selected = targets.resolve("project", new SourceTargetService.Selection("src/index.tsx:1:" + (original.indexOf("<h1") + 1), hash(original)));
    }

    private String hash(String text) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }

    private CreateRequest request(SourceTarget target) {
        return new CreateRequest("把标题改成两行", null, null, 0L, null, "targeted", null, null, null,
                null, null, null, null, "draft", selected.sourceHash(), target);
    }

    private void candidate(java.util.function.Consumer<Path> mutate) {
        doAnswer(invocation -> {
            Path workspace = invocation.getArgument(0);
            assertNotEquals(root, workspace);
            assertTrue(Files.readString(workspace.resolve("prompt.original.md")).contains("coffee"));
            assertTrue(((String) invocation.getArgument(1)).contains("<selected-jsx>"));
            mutate.accept(workspace);
            return new CreateAgentRunner.AgentOutcome("标题已修改", 1, true, true, true, "before", "after");
        }).when(agent).run(any(), any(), any(), any(), any(), any(), any(), any());
    }

    private void write(Path path, String text) {
        try { Files.writeString(path, text); } catch (Exception failure) { throw new RuntimeException(failure); }
    }

    @Test void resolvesExactJsxAndWritesOnlyTheSelectedElementFromIsolatedCandidate() throws Exception {
        assertEquals("<h1 style={{fontSize: 60}}>Coffee</h1>", selected.target().code());
        assertEquals(64, selected.target().fileHash().length());
        var legacy = targets.resolve("project", new SourceTargetService.Selection("src/index.tsx:1:" + (original.indexOf("<h1") + 1), hash(original).substring(0, 16)));
        assertEquals(selected.target(), legacy.target());
        candidate(workspace -> write(workspace.resolve("src/index.tsx"), original.replace("Coffee", "Coffee<br />Facts")));
        var result = targets.run(root, request(selected.target()), "edit", ResourceContextBuilder.ResourceContext.EMPTY, agent, "project");
        assertTrue(result.changed());
        assertTrue(worktrees.read("project").dirty());
        assertEquals(original.replace("Coffee", "Coffee<br />Facts"), Files.readString(root.resolve("src/index.tsx")));
        assertFalse(Files.exists(root.resolve(".fengmotion/source-write.lock")));
        try (var snapshots = Files.list(root.resolve(".fengmotion/source-snapshots"))) { assertEquals(0, snapshots.count()); }
    }

    @Test void staleFileAndForgedOriginalCodeAreRejectedBeforeAgent() throws Exception {
        var old = selected.target();
        assertEquals("source_changed", assertThrows(ApiException.class, () -> targets.validate(root,
                new SourceTarget(old.file(), old.line(), old.column(), old.fileHash(), "<h1>Forged</h1>"))).getCode());
        Files.writeString(root.resolve("src/index.tsx"), original + "\n// external edit\n");
        assertEquals("source_changed", assertThrows(ApiException.class, () -> targets.run(root, request(old), "edit",
                ResourceContextBuilder.ResourceContext.EMPTY, agent, "project")).getCode());
        verifyNoInteractions(agent);
    }

    @Test void rejectsChangesOutsideTheSelectedJsxEvenWithinTheSameFile() throws Exception {
        candidate(workspace -> write(workspace.resolve("src/index.tsx"), original.replace("Keep outro", "Wrongly changed outro")));
        assertEquals("source_target_out_of_scope", assertThrows(ApiException.class, () -> targets.run(root,
                request(selected.target()), "edit", ResourceContextBuilder.ResourceContext.EMPTY, agent, "project")).getCode());
        assertEquals(original, Files.readString(root.resolve("src/index.tsx")));
    }

    @Test void rejectsAdditionalFilesAndInvalidSyntaxWithoutTouchingWorkingTree() throws Exception {
        candidate(workspace -> {
            write(workspace.resolve("src/index.tsx"), original.replace("Coffee", "Changed"));
            write(workspace.resolve("src/unrelated.ts"), "export const changed = true");
        });
        assertEquals("source_target_out_of_scope", assertThrows(ApiException.class, () -> targets.run(root,
                request(selected.target()), "edit", ResourceContextBuilder.ResourceContext.EMPTY, agent, "project")).getCode());
        assertFalse(Files.exists(root.resolve("src/unrelated.ts")));
        candidate(workspace -> write(workspace.resolve("src/index.tsx"), original.replace("Coffee", "{broken syntax")));
        assertEquals("source_target_invalid", assertThrows(ApiException.class, () -> targets.run(root,
                request(selected.target()), "edit", ResourceContextBuilder.ResourceContext.EMPTY, agent, "project")).getCode());
        assertEquals(original, Files.readString(root.resolve("src/index.tsx")));
    }

    @Test void concurrentWorkingEditIsPreservedAndCandidateIsDiscarded() throws Exception {
        candidate(workspace -> {
            write(workspace.resolve("src/index.tsx"), original.replace("Coffee", "AI title"));
            write(root.resolve("src/index.tsx"), original.replace("Coffee", "Manual title"));
        });
        assertEquals("source_changed", assertThrows(ApiException.class, () -> targets.run(root,
                request(selected.target()), "edit", ResourceContextBuilder.ResourceContext.EMPTY, agent, "project")).getCode());
        assertEquals(original.replace("Coffee", "Manual title"), Files.readString(root.resolve("src/index.tsx")));
    }

    @Test void rejectsPathEscapesSymlinksAndNonJsxPositions() throws Exception {
        assertThrows(ApiException.class, () -> targets.resolve("project", new SourceTargetService.Selection("../external.tsx:1:1", hash(original))));
        assertThrows(ApiException.class, () -> targets.resolve("project", new SourceTargetService.Selection("src/index.tsx:1:1", hash(original))));
        Path external = Files.createTempFile("source-target-external", ".tsx");
        try {
            Files.writeString(external, original);
            Files.createSymbolicLink(root.resolve("src/linked.tsx"), external);
            assertThrows(ApiException.class, () -> targets.resolve("project", new SourceTargetService.Selection("src/linked.tsx:1:27", hash(original))));
        } finally { Files.deleteIfExists(external); }
    }

    @Test void rejectsTargetsOutsideSnapshotScopeBeforeAcceptingAnEdit() throws Exception {
        Files.createDirectory(root.resolve("untracked"));
        Files.writeString(root.resolve("untracked/Title.tsx"), original);
        assertEquals("source_target_invalid", assertThrows(ApiException.class, () -> targets.resolve("project",
                new SourceTargetService.Selection("untracked/Title.tsx:1:" + (original.indexOf("<h1") + 1), hash(original)))).getCode());
        Files.writeString(root.resolve("Title.tsx"), original);
        assertEquals("Title.tsx", targets.resolve("project", new SourceTargetService.Selection(
                "Title.tsx:1:" + (original.indexOf("<h1") + 1), hash(original))).target().file());
        verifyNoInteractions(agent);
    }

    @Test void writeGuardPreventsCandidateFromOverwritingAnActiveManualWriter() throws Exception {
        candidate(workspace -> write(workspace.resolve("src/index.tsx"), original.replace("Coffee", "AI title")));
        try (var guard = SourceWriteGuard.acquire(root)) {
            assertEquals("source_busy", assertThrows(ApiException.class, () -> targets.run(root,
                    request(selected.target()), "edit", ResourceContextBuilder.ResourceContext.EMPTY, agent, "project")).getCode());
        }
        assertEquals(original, Files.readString(root.resolve("src/index.tsx")));
    }

    @Test void unicodeAcrossPipeChunksKeepsExactSourceOffsets() {
        Path modules = Path.of("../frontend/node_modules").toAbsolutePath().normalize();
        var inspector = new SourceTargetInspector(new ObjectMapper(), Path.of("remotion").toAbsolutePath().toString(), modules.toString(), "node");
        String source = "//" + "汉".repeat(30_000) + "\n" + original;
        var span = inspector.inspect(source, 2, original.indexOf("<h1") + 1);
        assertEquals(source.indexOf("<h1"), span.start());
        assertEquals(source.indexOf("</h1>") + "</h1>".length(), span.end());
        assertEquals("<h1 style={{fontSize: 60}}>Coffee</h1>", span.code());
    }
}
