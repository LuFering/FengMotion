package com.fengmotion.server.fx.api;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.fengmotion.server.fx.service.semantic.SemanticSuggestionRepository;

/** 建议历史与来源事实分开返回，不改变技法的可执行状态。 */
@RestController
@RequestMapping("/api/fx-techniques")
public class FxSemanticSuggestionController {
    private final SemanticSuggestionRepository repository;
    public FxSemanticSuggestionController(SemanticSuggestionRepository repository) { this.repository = repository; }

    @GetMapping("/{id}/semantic-suggestions")
    public List<SemanticSuggestionRepository.StoredSuggestion> list(@PathVariable String id) {
        return repository.findByTechniqueId(id);
    }
}
