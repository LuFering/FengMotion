package com.fengmotion.server.common;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.*;
import com.fasterxml.jackson.databind.ObjectMapper;

class RequestTraceTest {
    @RestController static class Probe {
        @GetMapping("/business") String business() { throw new ApiException(HttpStatus.CONFLICT,"source_changed","changed"); }
        @GetMapping("/unexpected") String unexpected() { throw new IllegalStateException("sensitive internal details"); }
    }
    @Test void traceMatchesErrorEnvelopeAndDoesNotLeakBetweenRequests() throws Exception {
        var mvc=MockMvcBuilders.standaloneSetup(new Probe()).setControllerAdvice(new ApiExceptionHandler()).addFilters(new RequestTraceFilter()).build();
        var first=mvc.perform(get("/business")).andExpect(status().isConflict()).andExpect(header().string("Cache-Control","no-store")).andReturn().getResponse();
        String id=new ObjectMapper().readTree(first.getContentAsString()).path("error").path("requestId").asText();
        assertEquals(id,first.getHeader("X-Request-Id"));
        var second=mvc.perform(get("/unexpected")).andExpect(status().isInternalServerError()).andExpect(jsonPath("$.error.code").value("internal_error")).andReturn().getResponse();
        assertNotEquals(id,second.getHeader("X-Request-Id"));
        assertFalse(second.getContentAsString().contains("sensitive internal details"));
        assertNull(org.slf4j.MDC.get("requestId"));
    }
}
