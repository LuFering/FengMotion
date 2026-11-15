package com.fengmotion.server.fx.service.semantic;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.fx.service.semantic.SemanticSuggestionService.Evidence;
import com.fengmotion.server.fx.service.semantic.SemanticSuggestionService.Suggestion;

/** 独立的追加式建议历史；同一来源和生成版本以首次写入为准。 */
@Repository
public class SemanticSuggestionRepository {
    private static final TypeReference<List<String>> STRINGS = new TypeReference<>() {};
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public SemanticSuggestionRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public record StoredSuggestion(String id, String techniqueId, Suggestion suggestion, Instant createdAt) {}

    /** 原子插入或返回同一版本已有记录；不会更新已有建议。 */
    public StoredSuggestion save(String techniqueId, Suggestion suggestion) {
        if (techniqueId == null || techniqueId.isBlank() || suggestion == null || suggestion.evidence() == null)
            throw new IllegalArgumentException("techniqueId and suggestion evidence required");
        Evidence e = suggestion.evidence();
        jdbc.update("""
            INSERT INTO fx_semantic_suggestions
              (id, technique_id, component, source_path, source_text, content_hash, parser_version,
               model_id, prompt_version, model_generated_json, name, purpose, category, tags_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (technique_id, component, source_path, content_hash, parser_version, model_id, prompt_version)
            DO NOTHING
            """, UUID.randomUUID().toString(), techniqueId, suggestion.component(), e.sourcePath(), e.sourceText(),
            e.contentHash(), e.parserVersion(), suggestion.modelId(), suggestion.promptVersion(),
            write(suggestion.modelGenerated()), suggestion.name(), suggestion.purpose(), suggestion.category(),
            write(suggestion.tags()), Instant.now().toString());
        return jdbc.query("""
            SELECT * FROM fx_semantic_suggestions WHERE technique_id = ? AND component = ? AND source_path = ?
              AND content_hash = ? AND parser_version = ? AND model_id = ? AND prompt_version = ?
            """, (rs, row) -> map(rs), techniqueId, suggestion.component(), e.sourcePath(), e.contentHash(),
            e.parserVersion(), suggestion.modelId(), suggestion.promptVersion()).stream().findFirst().orElseThrow();
    }

    public Optional<StoredSuggestion> findById(String id) {
        return jdbc.query("SELECT * FROM fx_semantic_suggestions WHERE id = ?", (rs, row) -> map(rs), id)
                .stream().findFirst();
    }

    public List<StoredSuggestion> findByTechniqueId(String techniqueId) {
        return jdbc.query("SELECT * FROM fx_semantic_suggestions WHERE technique_id = ? ORDER BY created_at, id",
                (rs, row) -> map(rs), techniqueId);
    }

    private StoredSuggestion map(java.sql.ResultSet rs) throws java.sql.SQLException {
        Evidence evidence = new Evidence(rs.getString("source_path"), rs.getString("source_text"),
                rs.getString("content_hash"), rs.getString("parser_version"));
        Suggestion suggestion = new Suggestion(rs.getString("component"), rs.getString("name"),
                rs.getString("purpose"), rs.getString("category"), read(rs.getString("tags_json")), evidence,
                rs.getString("model_id"), rs.getString("prompt_version"), read(rs.getString("model_generated_json")));
        return new StoredSuggestion(rs.getString("id"), rs.getString("technique_id"), suggestion,
                Instant.parse(rs.getString("created_at")));
    }

    private String write(List<String> value) {
        try { return json.writeValueAsString(value); }
        catch (JsonProcessingException e) { throw new IllegalArgumentException("Cannot serialize suggestion", e); }
    }

    private List<String> read(String value) {
        try { return json.readValue(value, STRINGS); }
        catch (JsonProcessingException e) { throw new IllegalStateException("Invalid stored suggestion JSON", e); }
    }
}
