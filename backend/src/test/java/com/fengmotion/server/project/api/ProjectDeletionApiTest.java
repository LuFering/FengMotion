package com.fengmotion.server.project.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.ProjectDirectoryService;
import com.fengmotion.server.project.service.ProjectOperationLock;
import com.fengmotion.server.project.store.ProjectRepository;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ProjectDeletionApiTest {
    @TempDir Path root;
    @Autowired MockMvc mvc;
    @Autowired ProjectRepository projects;
    @Autowired ProjectOperationLock operations;
    @Autowired JdbcTemplate jdbc;
    @Autowired com.fengmotion.server.project.store.LocalStateStore documents;
    @Autowired com.fasterxml.jackson.databind.ObjectMapper json;
    @Autowired com.fengmotion.server.asset.service.AssetService assets;
    @Autowired org.mybatis.spring.SqlSessionTemplate sqlSession;

    private String project() throws Exception {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "delete test", null, null, root.toString(), Instant.now()));
        new ProjectDirectoryService().writeIdentity(root, id, "delete test");
        Files.writeString(root.resolve("prompt.original.md"), "keep until deleted");
        return id;
    }

    @Test void deletingProjectRejectsEveryRegisteredWriteEntry() throws Exception {
        String id = project();
        String prefix = "/api/projects/" + id;
        try (var deletion = operations.beginDeletion(id)) {
            mvc.perform(post(prefix + "/live-preview")).andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("project_deleting"));
            mvc.perform(post(prefix + "/creation-jobs").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"requestId\":\"blocked\",\"intent\":\"edit\",\"outputMode\":\"draft\"}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("project_deleting"));
            mvc.perform(post(prefix + "/render-jobs").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"requestId\":\"blocked\",\"baseVersion\":0,\"sourceHash\":\"files=0;sha256=empty\"}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("project_deleting"));
            mvc.perform(post(prefix + "/renders").contentType(MediaType.APPLICATION_JSON).content("{}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("project_deleting"));
            mvc.perform(post(prefix + "/workflow/init").contentType(MediaType.APPLICATION_JSON).content("{\"prompt\":\"edit\"}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("project_deleting"));
            mvc.perform(put(prefix + "/workflow/drafts/film-plan").contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"edit\"}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("project_deleting"));
            mvc.perform(post(prefix + "/chat-sessions").contentType(MediaType.APPLICATION_JSON).content("{\"projectId\":\"" + id + "\"}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("project_deleting"));
            mvc.perform(post("/api/assets/uploads").contentType(MediaType.APPLICATION_JSON).content("{\"fileName\":\"file.txt\",\"mimeType\":\"text/plain\",\"sizeBytes\":3,\"projectId\":\""+id+"\"}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("project_deleting"));
        }
        assertEquals("keep until deleted", Files.readString(root.resolve("prompt.original.md")));
    }

    @Test void purgeRefusesActivityThenRemovesProjectAndMessageReceipts() throws Exception {
        String id = project();
        String session = UUID.randomUUID().toString();
        String key = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO chat_sessions(id,project_id,title,created_at,updated_at) VALUES(?,?,?,?,?)", session,id,"session","now","now");
        jdbc.update("INSERT INTO chat_message_idempotency(key,request_hash,session_id,message_id,created_at) VALUES(?,?,?,?,?)",key,"hash",session,"message","now");
        try (var activity = operations.participate(id)) {
            mvc.perform(delete("/api/projects/{id}?purge=true", id)).andExpect(status().isConflict())
                    .andExpect(jsonPath("$.error.code").value("project_busy"));
            assertTrue(projects.findById(id).isPresent());
        }
        mvc.perform(delete("/api/projects/{id}?purge=true", id)).andExpect(status().isNoContent());
        sqlSession.clearCache();
        assertTrue(projects.findById(id).isEmpty());
        assertFalse(Files.exists(root));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM chat_message_idempotency WHERE key=?", Integer.class, key));
        mvc.perform(post("/api/projects/{id}/live-preview", id)).andExpect(status().isNotFound());
    }

    @Test void reassignmentsParticipateInBothSourceAndDestinationProjects() throws Exception {
        String source = project();
        String destination = UUID.randomUUID().toString();
        projects.save(new Project(destination, "destination", null, null, root.resolve("destination").toString(), Instant.now()));
        String documentId = UUID.randomUUID().toString();
        documents.put("review", documentId, source, 0, json.createObjectNode().put("text", "keep"), false);
        var asset = assets.importFile("ownership.txt", "text/plain", null, null,
                new java.io.ByteArrayInputStream(("unique-" + source).getBytes(java.nio.charset.StandardCharsets.UTF_8)), false, source).asset();
        String moveDocument = json.createObjectNode().put("projectId", destination).put("expectedRevision", 1)
                .set("data", json.createObjectNode().put("text", "moved")).toString();
        for (String deleting : java.util.List.of(source, destination)) {
            try (var deletion = operations.beginDeletion(deleting)) {
                mvc.perform(put("/api/local-documents/review/{id}", documentId).contentType(MediaType.APPLICATION_JSON).content(moveDocument))
                        .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("project_deleting"));
                mvc.perform(patch("/api/assets/{id}", asset.id()).header("If-Match", asset.etag())
                                .contentType(MediaType.APPLICATION_JSON).content("{\"projectId\":\"" + destination + "\"}"))
                        .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("project_deleting"));
                mvc.perform(post("/api/assets/batch-update").contentType(MediaType.APPLICATION_JSON)
                                .content(json.createObjectNode().put("projectId", destination)
                                        .set("ids", json.createArrayNode().add(asset.id())).toString()))
                        .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("project_deleting"));
            }
            assertEquals(source, documents.find("review", documentId).orElseThrow().projectId());
            assertEquals(source, assets.require(asset.id()).projectId());
        }
        mvc.perform(put("/api/local-documents/review/{id}", documentId).contentType(MediaType.APPLICATION_JSON).content(moveDocument))
                .andExpect(status().isOk()).andExpect(jsonPath("$.projectId").value(destination));
        mvc.perform(patch("/api/assets/{id}", asset.id()).header("If-Match", asset.etag())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"projectId\":\"" + destination + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.projectId").value(destination));
        try (var sourceDeletion = operations.beginDeletion(source); var targetDeletion = operations.beginDeletion(destination)) {
            assertFalse(operations.isBusy(source));
        }
    }
}
