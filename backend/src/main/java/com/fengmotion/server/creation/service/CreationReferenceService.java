package com.fengmotion.server.creation.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.List;

import org.springframework.stereotype.Service;

import com.fengmotion.server.retrieval.RetrievalResult;
import com.fengmotion.server.retrieval.SemanticIndex;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
@RequiredArgsConstructor
public class CreationReferenceService {
    static final String RETRIEVAL_LOG = "retrieval-log.md";

    private final SemanticIndex semanticIndex;

    String resolveCandidates(Path projectRoot, String intent) {
        String query = (intent == null || intent.isBlank()) ? readPrompt(projectRoot) : intent;
        if (query == null || query.isBlank()) return "";

        List<String> kinds = List.of("technique", "capability");
        RetrievalResult result;
        try {
            result = semanticIndex.search(query, kinds, 6);
        } catch (RuntimeException failed) {
            log.warn("语义检索异常，本轮不提供候选：{}", failed.getMessage());
            result = RetrievalResult.empty(RetrievalResult.Status.SERVICE_FAILED, query, kinds);
        }

        writeRetrievalLog(projectRoot, result);
        log.info("创作检索：status={} query={} 命中 {} 条 {}", result.status(),
                abbreviate(query, 60), result.hits().size(),
                result.hits().stream().map(hit -> hit.kind() + ":" + hit.id()).toList());

        switch (result.status()) {
            case SERVICE_FAILED -> {
                return """
                        （本轮语义检索不可用：向量服务调用失败。**这不等于「库里没有相关内容」**。
                        你可以自行设计画面，但不要声称查过库、也不要编造库里没有的技法名；
                        如需确认某条技法是否存在，直接去技法库目录查。）
                        """;
            }
            case INDEX_NOT_READY -> {
                return """
                        （本轮语义检索不可用：索引尚未建立。**这不等于「库里没有相关内容」**。
                        可以自行设计画面，但不要声称查过库、也不要编造库里没有的技法名。）
                        """;
            }
            case SUCCESS_NO_MATCH -> {
                return """
                        （本轮已检索技法库与能力库，确实没有相近条目。可以自行设计，
                        但不要凭空引用库里不存在的技法名。）
                        """;
            }
            case DEGRADED_LITERAL_NO_MATCH -> {
                return """
                        （本轮语义检索不可用，改用索引原文做字面匹配，也没有结果。
                        **这不等于「库里没有相关内容」** —— 字面匹配不懂同义词，
                        「眩晕感」搜不到「多莉变焦」属于正常。可以自行设计画面，
                        但不要声称查过库、也不要编造库里没有的技法名。）
                        """;
            }
            case DEGRADED_LITERAL_WITH_HITS -> {
            }
            default -> {
            }
        }

        boolean degraded = result.status() == RetrievalResult.Status.DEGRADED_LITERAL_WITH_HITS;
        StringBuilder candidates = new StringBuilder();
        if (degraded) {
            candidates.append("""
                    下面是从技法库与能力库召回的字面匹配条目（**本轮语义检索不可用，
                    这些只是原文里出现了相近的词，不代表语义相关**）：
                    请自行判断是否真的贴合本轮需求，宁可不采用也不要硬套；
                    不要编造库里没有的技法。
                    完整检索记录见项目目录的 %s。
                    """.formatted(RETRIEVAL_LOG));
        } else {
            candidates.append("""
                    下面是从技法库与能力库按这一轮需求召回的相关条目（不是用户指定，是可选参考）：
                    用得上就照着做或借鉴，用不上就别硬套；不要编造库里没有的技法。
                    完整检索记录见项目目录的 %s。
                    """.formatted(RETRIEVAL_LOG));
        }
        for (var hit : result.hits()) {
            candidates.append("- [").append(hit.kind()).append("] ").append(hit.id())
                    .append(degraded ? "（字面匹配 " : "（相似度 ")
                    .append(String.format("%.2f", hit.score())).append("）：")
                    .append(abbreviate(hit.text(), 160)).append('\n');
        }
        return candidates.toString();
    }

    private void writeRetrievalLog(Path projectRoot, RetrievalResult result) {
        StringBuilder content = new StringBuilder();
        content.append("\n## ").append(Instant.now()).append('\n')
                .append("- 状态：`").append(result.status()).append("`（")
                .append(switch (result.status()) {
                    case SUCCESS_WITH_HITS -> "检索成功，有候选";
                    case SUCCESS_NO_MATCH -> "检索成功，无相近条目";
                    case DEGRADED_LITERAL_WITH_HITS -> "语义检索不可用，改为索引原文字面匹配，有候选";
                    case DEGRADED_LITERAL_NO_MATCH -> "语义检索不可用，字面匹配也没有结果";
                    case INDEX_NOT_READY -> "索引未就绪，本轮没有真正比对过内容";
                    case SERVICE_FAILED -> "向量服务调用失败，且无可做字面匹配的原文";
                })
                .append("）\n")
                .append("- 查询：").append(oneLine(result.query())).append('\n')
                .append("- 范围：").append(result.kinds() == null || result.kinds().isEmpty()
                        ? "全部" : String.join("、", result.kinds())).append('\n');
        if (result.hits().isEmpty()) {
            content.append("- 命中：无\n");
        } else {
            content.append("- 命中：\n");
            boolean literal = result.status() == RetrievalResult.Status.DEGRADED_LITERAL_WITH_HITS;
            for (var hit : result.hits()) {
                content.append("  - `").append(hit.kind()).append(':').append(hit.id()).append("` 段")
                        .append(hit.chunk()).append(literal ? " 字面匹配 " : " 相似度 ")
                        .append(String.format("%.3f", hit.score()))
                        .append("：").append(oneLine(abbreviate(hit.text(), 200))).append('\n');
            }
        }
        try {
            Path logFile = projectRoot.resolve(RETRIEVAL_LOG);
            boolean fresh = !Files.isRegularFile(logFile);
            Files.writeString(logFile,
                    (fresh ? "# 检索记录\n\n由后端在每次创作前自动追加：本文件只记录系统检索事实。\n"
                            + "agent 是否采用、为何不用，见 decisions.md。\n" : "")
                            + content,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException failed) {
            log.warn("写入检索记录失败（不影响创作）：{}", failed.getMessage());
        }
    }

    private String readPrompt(Path projectRoot) {
        try {
            Path file = projectRoot.resolve("prompt.original.md");
            return Files.isRegularFile(file) ? Files.readString(file) : "";
        } catch (IOException unreadable) {
            return "";
        }
    }

    private static String oneLine(String text) {
        return text == null ? "" : text.replaceAll("\\s+", " ").trim();
    }

    private static String abbreviate(String text, int max) {
        if (text == null) return "";
        String flat = text.replace('\n', ' ').strip();
        return flat.length() <= max ? flat : flat.substring(0, max) + "…";
    }
}
