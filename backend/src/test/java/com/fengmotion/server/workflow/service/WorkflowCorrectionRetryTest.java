package com.fengmotion.server.workflow.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;

class WorkflowCorrectionRetryTest {
    @TempDir Path root;

    @Test void sameRequestIsRecordedOnceButNewRequestIsRecordedAgain() throws Exception {
        Files.writeString(root.resolve("prompt.original.md"), "原始需求");
        var projects = mock(ProjectRepository.class);
        when(projects.findById("p")).thenReturn(Optional.of(new Project("p", "项目", null, null, root.toString(), Instant.now())));
        var service = new WorkflowProjectService(projects, mock(WorkflowToolRunner.class));
        String requestId = UUID.randomUUID().toString();
        service.recordCorrection("p", "调整字幕", requestId);
        service.recordCorrection("p", "调整字幕", requestId);
        assertThrows(com.fengmotion.server.common.ApiException.class, () -> service.recordCorrection("p", "另一条意见", requestId));
        service.recordCorrection("p", "调整字幕", UUID.randomUUID().toString());
        String content = Files.readString(root.resolve("corrections.md"));
        assertEquals(2, content.split("调整字幕", -1).length - 1);
    }
}
