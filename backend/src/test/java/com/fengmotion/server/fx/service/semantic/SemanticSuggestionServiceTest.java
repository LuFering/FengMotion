package com.fengmotion.server.fx.service.semantic;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;

import com.fengmotion.server.fx.service.semantic.SemanticSuggestionService.Candidate;
import com.fengmotion.server.fx.service.semantic.SemanticSuggestionService.Result;

class SemanticSuggestionServiceTest {
    private static final Candidate FIRST = new Candidate("Fade", "src/Fade.tsx", "你好\n", "parser-v2");
    private static final Candidate SECOND = new Candidate("Zoom", "src/Zoom.tsx", "export const Zoom = 1;", "parser-v3");
    private static final Set<String> CATEGORIES = Set.of("转场", "动画");
    private static final String VALID = "{\"component\":\"Fade\",\"name\":\"淡入\",\"purpose\":\"用于画面之间平滑过渡\",\"category\":\"转场\",\"tags\":[\"过渡\"]}";

    private static SemanticSuggestionService service(String response) {
        return new SemanticSuggestionService(prompt -> response, "model-42");
    }

    @Test
    void acceptsOnlyInputCandidatesAndPreservesEvidenceAndVersions() throws Exception {
        String hallucination = VALID.replace("Fade", "Invented");
        Result result = service("{\"suggestions\":[" + VALID + "," + hallucination + "]}")
                .suggest(List.of(FIRST, SECOND), CATEGORIES);
        assertEquals(1, result.suggestions().size());
        var suggestion = result.suggestions().getFirst();
        assertEquals("Fade", suggestion.component());
        assertEquals("淡入", suggestion.name());
        assertEquals(List.of("过渡"), suggestion.tags());
        assertEquals(FIRST.sourcePath(), suggestion.evidence().sourcePath());
        assertEquals(FIRST.sourceText(), suggestion.evidence().sourceText());
        assertEquals("parser-v2", suggestion.evidence().parserVersion());
        assertEquals("4e0826721642ed8e3a27e7147538ac7b7013a08fe5ae343a8ef09749b7e5790f", suggestion.evidence().contentHash());
        assertEquals("model-42", suggestion.modelId());
        assertEquals("semantic-suggestion-v1", suggestion.promptVersion());
        assertEquals(List.of("name", "purpose", "category", "tags"), suggestion.modelGenerated());
        assertEquals(List.of(new SemanticSuggestionService.Rejection("Invented", "unknown-component")), result.rejected());
        assertEquals(List.of("Zoom"), result.missing());
    }

    @Test
    void rejectsEveryDuplicateInsteadOfAcceptingFirst() throws Exception {
        Result result = service("{\"suggestions\":[" + VALID + "," + VALID + "]}")
                .suggest(List.of(FIRST, SECOND), CATEGORIES);
        assertTrue(result.suggestions().isEmpty());
        assertEquals(List.of(new SemanticSuggestionService.Rejection("Fade", "duplicate-component"),
                new SemanticSuggestionService.Rejection("Fade", "duplicate-component")), result.rejected());
        assertEquals(List.of("Fade", "Zoom"), result.missing());
    }

    @Test
    void rejectsInvalidJsonAndEnvelope() {
        for (String response : List.of("{", "{\"suggestions\":[],\"suggestions\":[]}", "[]", "{\"suggestions\":[],\"extra\":1}")) {
            assertThrows(IllegalArgumentException.class, () -> service(response).suggest(List.of(FIRST), CATEGORIES), response);
        }
        assertThrows(IllegalArgumentException.class, () -> service(null).suggest(List.of(FIRST), CATEGORIES));
    }

    @Test
    void rejectsInvalidFieldsCategoriesAndTags() throws Exception {
        String extra = VALID.replace("\"tags\":[", "\"extra\":1,\"tags\":[");
        String category = VALID.replace("转场", "不存在");
        String tags = VALID.replace("[\"过渡\"]", "[\"过渡\",\"过渡\"]");
        for (var test : List.of(new String[]{extra, "invalid-fields"}, new String[]{category, "invalid-content"},
                new String[]{tags, "invalid-tags"})) {
            Result result = service("{\"suggestions\":[" + test[0] + "]}").suggest(List.of(FIRST), CATEGORIES);
            assertTrue(result.suggestions().isEmpty());
            assertEquals(List.of(new SemanticSuggestionService.Rejection("Fade", test[1])), result.rejected());
            assertEquals(List.of("Fade"), result.missing());
        }
    }

    @Test
    void validatesInputsBeforeCallingModel() {
        AtomicBoolean called = new AtomicBoolean();
        var service = new SemanticSuggestionService(prompt -> { called.set(true); return "{}"; }, "model");
        assertThrows(IllegalArgumentException.class, () -> service.suggest(List.of(), CATEGORIES));
        assertThrows(IllegalArgumentException.class, () -> service.suggest(java.util.Collections.nCopies(9, FIRST), CATEGORIES));
        assertThrows(IllegalArgumentException.class, () -> service.suggest(List.of(FIRST, FIRST), CATEGORIES));
        assertThrows(IllegalArgumentException.class, () -> service.suggest(List.of(new Candidate("bad-name", "a", "source", "v")), CATEGORIES));
        assertThrows(IllegalArgumentException.class, () -> service.suggest(List.of(FIRST), Set.of()));
        assertFalse(called.get());
        assertThrows(IllegalArgumentException.class, () -> new SemanticSuggestionService(null, "model"));
        assertThrows(IllegalArgumentException.class, () -> new SemanticSuggestionService(prompt -> "{}", " "));
    }
}
