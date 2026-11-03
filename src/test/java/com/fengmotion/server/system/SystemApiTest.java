package com.fengmotion.server.system;
import org.springframework.test.context.ActiveProfiles;


import com.fengmotion.server.FengMotionServerApplication;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(classes = FengMotionServerApplication.class)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SystemApiTest {
    @Autowired MockMvc mvc;

    @Test
    void reportsHealthAndUnavailableCapabilities() throws Exception {
        mvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.demo").doesNotExist())
                .andExpect(jsonPath("$.uptimeMs").isNumber());
        mvc.perform(get("/api/capabilities"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.agent.status").value("unavailable"))
                .andExpect(jsonPath("$.cloudRender.status").value("unavailable"));
    }

    @Test
    void removedDemoEndpointsAreNotRegistered() throws Exception {
        mvc.perform(post("/api/tasks")).andExpect(status().isNotFound());
        mvc.perform(post("/api/render")).andExpect(status().isNotFound());
        mvc.perform(get("/api/versions")).andExpect(status().isNotFound());
        mvc.perform(post("/api/versions/example/restore")).andExpect(status().isNotFound());
    }

    @Test
    void allowsConfiguredDevelopmentOriginsAndPatch() throws Exception {
        mvc.perform(options("/api/settings")
                        .header(HttpHeaders.ORIGIN, "http://localhost:4173")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "PATCH"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:4173"));
        mvc.perform(options("/api/settings")
                        .header(HttpHeaders.ORIGIN, "http://example.com")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "PATCH"))
                .andExpect(status().isForbidden());
    }
}
