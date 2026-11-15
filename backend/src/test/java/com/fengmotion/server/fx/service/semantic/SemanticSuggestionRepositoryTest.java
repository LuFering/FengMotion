package com.fengmotion.server.fx.service.semantic;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.fx.service.semantic.SemanticSuggestionService.Evidence;
import com.fengmotion.server.fx.service.semantic.SemanticSuggestionService.Suggestion;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class SemanticSuggestionRepositoryTest {
    @Autowired SemanticSuggestionRepository repository;
    @Autowired JdbcTemplate jdbc;

    private Suggestion suggestion(String hash, String parser, String model, String prompt, String name) {
        return new Suggestion("Effect", name, "中文用途与详细说明", "visual", List.of("标签", "光"),
                new Evidence("src/Effect.tsx", "原始源码\n{}", hash, parser), model, prompt,
                List.of("name", "purpose", "category", "tags"));
    }

    @Test
    void preservesEvidenceAndKeepsFirstResultOnRetry() {
        String techniqueId = UUID.randomUUID().toString();
        Suggestion input = suggestion("hash", "parser-1", "model-1", "prompt-1", "名称");
        var saved = repository.save(techniqueId, input);
        var retry = repository.save(techniqueId, suggestion("hash", "parser-1", "model-1", "prompt-1", "另一个名称"));
        assertEquals(saved, retry);
        assertEquals(input, repository.findById(saved.id()).orElseThrow().suggestion());
        assertEquals(techniqueId, saved.techniqueId());
        assertNotNull(saved.createdAt());
        assertEquals(List.of(saved), repository.findByTechniqueId(techniqueId));
        assertTrue(repository.findById("missing").isEmpty());
    }

    @Test
    void retainsEachVersionAndDoesNotAlterTechnique() {
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO fx_techniques (id, name, category, exec_type, execution_status, impl, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                id, "原始名称", "visual", "runnable", "not-implemented", "manual", "2026-01-01T00:00:00Z");
        var before = jdbc.queryForMap("SELECT * FROM fx_techniques WHERE id = ?", id);
        var first = repository.save(id, suggestion("hash-1", "parser-1", "model-1", "prompt-1", "一"));
        repository.save(id, suggestion("hash-2", "parser-1", "model-1", "prompt-1", "二"));
        repository.save(id, suggestion("hash-1", "parser-2", "model-1", "prompt-1", "三"));
        repository.save(id, suggestion("hash-1", "parser-1", "model-2", "prompt-1", "四"));
        repository.save(id, suggestion("hash-1", "parser-1", "model-1", "prompt-2", "五"));
        assertEquals(5, repository.findByTechniqueId(id).size());
        assertEquals(first, repository.findById(first.id()).orElseThrow());
        assertEquals(before, jdbc.queryForMap("SELECT * FROM fx_techniques WHERE id = ?", id));
    }
}
