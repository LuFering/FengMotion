package com.fengmotion.server.project.store;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import com.fengmotion.server.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.domain.Project;

@SpringBootTest
@ActiveProfiles("test")
class SceneHistoryIntegrityTest {
    @Autowired ProjectSceneRepository scenes;
    @Autowired ProjectRepository projects;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    @Test void conflictingHistoryCannotBeOverwrittenAndCurrentVersionRollsBack() {
        verifyHistoryConflict(true);
    }

    @Test void orphanFirstHistoryCannotBeOverwrittenByNewCurrentScene() {
        verifyHistoryConflict(false);
    }

    private void verifyHistoryConflict(boolean hasCurrent) {
        String id = UUID.randomUUID().toString();
        projects.save(new Project(id, "history integrity", null, null, "/tmp/history-" + id, Instant.now()));
        try {
            var original = json.createObjectNode().put("value", "original");
            long base = hasCurrent ? 1 : 0;
            if (hasCurrent) scenes.commitWithSnapshot(id, 0, original, null, "", "", null, "task", null);
            jdbc.update("""
                    INSERT INTO project_scene_versions
                    (project_id, version, film_json, task_id, prompt, edit_summary, artifact_path, source, from_version, created_at)
                    VALUES (?, ?, ?, NULL, '', '', NULL, 'task', NULL, ?)
                    """, id, base + 1, original.toString(), Instant.now().toString());
            assertEquals("scene_history_conflict", assertThrows(ApiException.class, () -> scenes.commitWithSnapshot(id, base,
                    json.createObjectNode().put("value", "replacement"), null, "", "", null, "task", null)).getCode());
            assertEquals(original, scenes.findVersion(id, base + 1).orElseThrow().film());
            if (hasCurrent) {
                assertEquals(1, scenes.find(id).orElseThrow().version());
                assertEquals(original, scenes.find(id).orElseThrow().film());
            } else {
                assertTrue(scenes.find(id).isEmpty());
            }
        } finally {
            jdbc.update("DELETE FROM project_scene_versions WHERE project_id = ?", id);
            jdbc.update("DELETE FROM project_scenes WHERE project_id = ?", id);
            jdbc.update("DELETE FROM projects WHERE id = ?", id);
        }
    }
}
