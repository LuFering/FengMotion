package com.fengmotion.server.config;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class JsonInputApiTest {
    @Autowired MockMvc mvc;

    @Test void fractionalVersionsAndFramesAreRejectedBeforeProjectLookup() throws Exception {
        for (String body : java.util.List.of(
                "{\"baseVersion\":1.5,\"sourceHash\":\"files=0;sha256=empty\",\"frame\":0}",
                "{\"baseVersion\":1,\"sourceHash\":\"files=0;sha256=empty\",\"frame\":0.5}")) {
            mvc.perform(post("/api/projects/missing/source/frame").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("validation_error"))
                    .andExpect(header().string("Cache-Control", "no-store"));
        }
        mvc.perform(put("/api/local-documents/workflow/rejected-fraction").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedRevision\":0.5,\"data\":{}}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("validation_error"));
    }

    @Test void duplicateFieldsAndMultipleBodiesCannotOverrideTheUsersRequest() throws Exception {
        for (String body : java.util.List.of("{\"name\":\"first\",\"name\":\"second\"}",
                "{\"name\":\"first\"} {\"name\":\"second\"}",
                "{\"name\":\"first\",\"extra\":{\"id\":1,\"id\":2}}")) {
            mvc.perform(post("/api/projects").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("validation_error"));
        }
    }
}
