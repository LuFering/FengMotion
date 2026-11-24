package com.fengmotion.server.project.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.store.LocalStateStore;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class LocalDocumentPageApiTest {
    @Autowired MockMvc mvc;
    @Autowired LocalStateStore documents;
    @Autowired ObjectMapper json;

    @Test void pagedApiKeepsLegacyArrayAndDoesNotExposeInternalJobs() throws Exception {
        String project = UUID.randomUUID().toString();
        documents.put("workflow", "first-" + project, project, 0, json.createObjectNode(), false);
        documents.put("workflow", "second-" + project, project, 0, json.createObjectNode(), true);
        documents.put("workbench-job", "private-" + project, project, 0, json.createObjectNode(), false);
        String body = mvc.perform(get("/api/local-documents/page").param("projectId", project).param("limit", "1"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.items.length()").value(1)).andExpect(jsonPath("$.items[0].namespace").value("workflow"))
                .andReturn().getResponse().getContentAsString();
        mvc.perform(get("/api/local-documents/page").param("projectId", project).param("limit", "1")
                        .param("cursor", json.readTree(body).path("nextCursor").asText()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].deleted").value(true))
                .andExpect(jsonPath("$.nextCursor").isEmpty());
        mvc.perform(get("/api/local-documents/page").param("namespace", "workbench-job"))
                .andExpect(status().isBadRequest()).andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(get("/api/local-documents")).andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
    }
}
