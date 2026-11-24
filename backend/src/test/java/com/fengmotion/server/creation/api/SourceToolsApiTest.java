package com.fengmotion.server.creation.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.http.MediaType;
import com.fengmotion.server.creation.service.SourceFrameService;
import com.fengmotion.server.creation.service.WorkbenchJobs;
import com.fengmotion.server.project.api.SourceRecoveryController;
import com.fengmotion.server.project.service.SourceRecoveryService;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.common.ApiExceptionHandler;

class SourceToolsApiTest {
    @Test void frameAndRecoveryErrorsAreNotCached() throws Exception {
        var frames=mock(SourceFrameService.class);
        when(frames.capture(any(),any())).thenThrow(new ApiException(org.springframework.http.HttpStatus.CONFLICT,"source_changed","changed"));
        var recovery=mock(SourceRecoveryService.class);
        when(recovery.inspect("missing")).thenThrow(new ApiException(org.springframework.http.HttpStatus.NOT_FOUND,"not_found","missing"));
        var mvc=MockMvcBuilders.standaloneSetup(new SourceFrameController(frames),new SourceRecoveryController(recovery))
                .setControllerAdvice(new ApiExceptionHandler()).build();
        mvc.perform(post("/api/projects/project/source/frame").contentType(MediaType.APPLICATION_JSON).content("{\"baseVersion\":1,\"sourceHash\":\"old\",\"frame\":0}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("source_changed"))
                .andExpect(header().string("Cache-Control","no-store"));
        mvc.perform(get("/api/projects/missing/source/recovery")).andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control","no-store"));
    }
    @Test void backgroundJobSubmissionReturnsAcceptedWithoutBlocking() throws Exception {
        var jobs=mock(WorkbenchJobs.class);
        when(jobs.submit(eq("project"),any())).thenReturn(new WorkbenchJobs.Job("project","job","timeline_recovery","accepted",null,null,null,"now"));
        var mvc=MockMvcBuilders.standaloneSetup(new WorkbenchJobController(jobs)).build();
        mvc.perform(post("/api/projects/project/workbench-jobs").contentType(MediaType.APPLICATION_JSON)
                .content("{\"requestId\":\"job\",\"kind\":\"timeline_recovery\",\"artifactPath\":\"renders/a.mp4\"}"))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.state").value("accepted"))
                .andExpect(header().string("Cache-Control","no-store"));
    }
}
