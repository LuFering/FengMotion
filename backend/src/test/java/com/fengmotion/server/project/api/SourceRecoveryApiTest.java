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
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.service.*;
import com.fengmotion.server.project.store.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class SourceRecoveryApiTest {
    @TempDir Path root;
    @Autowired MockMvc mvc;
    @Autowired ProjectRepository projects;
    @Autowired ProjectSceneRepository scenes;
    @Autowired ProjectSourceSnapshots snapshots;
    @Autowired ObjectMapper json;

    @Test void recoversThroughHttpAndDoesNotCreateASceneVersion() throws Exception {
        String id=UUID.randomUUID().toString();
        projects.save(new Project(id,"Recovery",null,null,root.toString(),Instant.now()));
        Files.createDirectories(root.resolve("src"));
        Files.writeString(root.resolve("src/index.tsx"),"original");
        String before=ProjectSourceFingerprint.compute(root);
        String baseline=snapshots.capture(root);
        try(var workspace=snapshots.createWorkspace(root,baseline,before)) {
            Files.writeString(workspace.path().resolve("src/index.tsx"),"candidate");
            String candidate=snapshots.capture(root,workspace.path());
            var recovery=snapshots.restore(root,candidate,ProjectSourceFingerprint.compute(workspace.path()));
            recovery.retainPending();
        }
        String endpoint="/api/projects/"+id+"/source/recovery";
        var state=json.readTree(mvc.perform(get(endpoint)).andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store"))
                .andReturn().getResponse().getContentAsString());
        var request=json.createObjectNode().put("sourceHash",state.path("sourceHash").asText()).put("recoveryId",state.path("recoveries").get(0).path("id").asText());
        mvc.perform(post(endpoint).contentType(MediaType.APPLICATION_JSON).content(request.toString())).andExpect(status().isOk())
                .andExpect(jsonPath("$.sourceHash").value(before)).andExpect(jsonPath("$.recoveries").isEmpty());
        mvc.perform(post(endpoint).contentType(MediaType.APPLICATION_JSON).content(request.toString())).andExpect(status().isOk());
        assertEquals("original",Files.readString(root.resolve("src/index.tsx")));
        assertTrue(scenes.listVersions(id).isEmpty());
    }

    @Test void liveLockCannotBeClearedByRecoveryApi() throws Exception {
        String id=UUID.randomUUID().toString();
        projects.save(new Project(id,"Recovery",null,null,root.toString(),Instant.now()));
        try(var guard=SourceWriteGuard.acquire(root)) {
            var owner=json.readTree(Files.readString(root.resolve(".fengmotion/source-write.lock/owner.json")));
            var request=json.createObjectNode().put("sourceHash",ProjectSourceFingerprint.compute(root)).put("lockToken",owner.path("token").asText());
            mvc.perform(post("/api/projects/"+id+"/source/recovery").contentType(MediaType.APPLICATION_JSON).content(request.toString()))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("source_busy"))
                    .andExpect(header().string("Cache-Control","no-store"));
            assertTrue(Files.exists(root.resolve(".fengmotion/source-write.lock/owner.json")));
        }
    }
}
