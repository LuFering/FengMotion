package com.fengmotion.server.workflow.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.store.ProjectRepository;

class StoryboardServiceTest {
    @TempDir Path root;
    private StoryboardService service() {
        var projects = mock(ProjectRepository.class);
        when(projects.findById("project")).thenReturn(Optional.of(new Project("project", "test", null, null, root.toString(), Instant.now())));
        return new StoryboardService(projects, new ProjectOperationLock(), new ObjectMapper());
    }

    @Test void explicitStoryboardPreservesOriginalTimingAndDoesNotWriteFiles() throws Exception {
        Files.writeString(root.resolve("storyboard.json"), """
                {"schemaVersion":"1.0","type":"storyboard","entries":[
                {"id":"s1","segment":"开场","timecode":"00:12–00:19","duration":"约7s","narration":"原话","visual":"杯子","motion":"推进"}]}
                """);
        var result = service().read("project");
        assertEquals("storyboard.json", result.source());
        assertEquals("00:12–00:19", result.items().getFirst().timecode());
        assertEquals("约7s", result.items().getFirst().duration());
        assertEquals("原话", result.items().getFirst().narration());
        try (var files = Files.list(root)) { assertEquals(1, files.count()); }
    }

    @Test void existingShotPlanUsesExplicitCaptionAndEventReferences() throws Exception {
        Files.copy(Path.of("../frontend/workflow-v0.1.1/prompt-first/examples/continuity-reference/shot-plan.json"), root.resolve("shot-plan.json"));
        var result = service().read("project");
        assertEquals(3, result.items().size());
        assertEquals("SH01", result.items().getFirst().id());
        assertEquals("0–90 frames @ 30 fps", result.items().getFirst().timecode());
        assertTrue(result.items().getFirst().narration().contains("建立空间"));
        assertTrue(result.items().getFirst().visual().contains("光进入"));
        assertEquals("", result.items().getFirst().motion());
    }

    @Test void noPlanIsEmptyButInvalidAndLinkedPlansAreNotSilentlyIgnored() throws Exception {
        assertTrue(service().read("project").items().isEmpty());
        for (String contents : java.util.List.of("null", "[]", "{bad", "{\"type\":\"unknown\"}",
                "{\"schemaVersion\":\"1.0\",\"type\":\"storyboard\",\"entries\":[{\"id\":\"a\"},{\"id\":\"a\"}]}")) {
            Files.writeString(root.resolve("storyboard.json"), contents);
            assertEquals("storyboard_invalid", assertThrows(ApiException.class, () -> service().read("project")).getCode());
        }
        Files.delete(root.resolve("storyboard.json"));
        Files.createSymbolicLink(root.resolve("storyboard.json"), root.resolve("outside.json"));
        assertEquals("storyboard_invalid", assertThrows(ApiException.class, () -> service().read("project")).getCode());
    }
}
