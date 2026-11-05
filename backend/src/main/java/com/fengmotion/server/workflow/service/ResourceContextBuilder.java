package com.fengmotion.server.workflow.service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.asset.service.AssetService;
import com.fengmotion.server.asset.service.AssetStorage;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.fx.domain.FxTechnique;
import com.fengmotion.server.fx.service.FxTechniqueService;
import com.fengmotion.server.reference.domain.ReferenceSegment;
import com.fengmotion.server.reference.domain.ReferenceVideo;
import com.fengmotion.server.reference.service.ReferenceVideoService;
import com.fasterxml.jackson.databind.JsonNode;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 把用户选中的三库资源，翻译成 agent 能准确理解的创作上下文。
 *
 * <p><strong>为什么不能只传一个 ID 列表</strong>：同一个素材，用户可能是要
 * 「把它放进画面」，也可能只是「参考它的风格」；参考片可能是「借鉴这段的手法」，
 * 还可能是「明确别用它的画面」。压成同一种引用，agent 只能猜 ——
 * 猜错的结果是画面里出现了不该出现的素材。</p>
 *
 * <p><strong>三类分别措辞</strong>：
 * <ul>
 *   <li>素材 → 说明文件路径与用途（画面素材 / 仅参考 / 音频 / 资料）</li>
 *   <li>参考片 → 说明是哪条片子的哪一段（毫秒范围换算成人可读的秒），
 *       以及要借鉴什么、要避开什么</li>
 *   <li>特效 → 说明是「按这种技法做」还是「只作技法参考」</li>
 * </ul>
 *
 * <p><strong>不允许静默降级</strong>：某个 ID 查不到就明确报错，
 * 而不是跳过它继续 —— 用户会以为资源已经用上了。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ResourceContextBuilder {

    private final AssetService assets;
    private final FxTechniqueService techniques;
    private final ReferenceVideoService references;
    private final AssetStorage storage;

    /**
     * 由请求体里的 references 组装人类可读 + 机器可读的资源上下文。
     *
     * @param references 请求里的引用数组；可为 null
     * @return 组装结果；没有三库资源时 available=false
     */
    public ResourceContext build(JsonNode refsNode) {
        if (refsNode == null || refsNode.isNull()) return ResourceContext.EMPTY;
        if (!refsNode.isArray() || refsNode.size() > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "reference_invalid", "资源引用必须是数组，且不能超过 100 项");
        }
        if (refsNode.isEmpty()) return ResourceContext.EMPTY;

        List<String> lines = new ArrayList<>();
        List<ResolvedResource> resolved = new ArrayList<>();

        for (JsonNode ref : refsNode) {
            String kind = ref.path("kind").asText("");
            switch (kind) {
                case "asset" -> {
                    String id = required(ref, "assetId", kind);
                    Asset asset = assets.require(id);
                    String purpose = ref.path("purpose").asText("unspecified");
                    String note = ref.path("note").asText("");
                    /* 库里的 fileUrl 是相对路径，前端拿到的却是 /api/assets/{id}/content。
                       直接写进上下文 agent 读不到 —— 必须换成 agent 能打开的绝对路径。 */
                    Path file = absoluteAssetPath(asset);
                    lines.add(describeAsset(asset, file, purpose, note));
                    resolved.add(new ResolvedResource("asset", id, asset.name(), purpose,
                            file.toString(), null, null));
                }
                case "reference" -> {
                    String segmentId = required(ref, "segmentId", kind);
                    ReferenceSegment segment = references.requireSegment(segmentId);
                    ReferenceVideo video = references.requireVideo(segment.videoId());
                    String wants = ref.path("wants").asText("");
                    String avoid = ref.path("avoid").asText("");
                    if (ref.hasNonNull("videoId") && !video.id().equals(ref.path("videoId").asText())) {
                        throw new ApiException(HttpStatus.BAD_REQUEST, "reference_invalid", "参考片与片段不匹配，请重新选择");
                    }
                    for (String field : List.of("startMs", "endMs")) {
                        if (ref.hasNonNull(field) && !ref.path(field).isIntegralNumber()) {
                            throw new ApiException(HttpStatus.BAD_REQUEST, "reference_invalid", "参考片时间必须是整数毫秒");
                        }
                    }
                    long startMs = ref.hasNonNull("startMs") ? ref.path("startMs").asLong() : segment.startMs();
                    long endMs = ref.hasNonNull("endMs") ? ref.path("endMs").asLong() : segment.endMs();
                    if (startMs < segment.startMs() || endMs > segment.endMs() || endMs <= startMs) {
                        throw new ApiException(HttpStatus.BAD_REQUEST, "reference_invalid", "引用区间已超出片段，请重新选择参考片段");
                    }
                    Path file = absoluteReferencePath(video);
                    lines.add(describeReference(video, file, segment, startMs, endMs, wants, avoid));
                    resolved.add(new ResolvedResource("reference", segmentId,
                            video.title() + " · 片段 " + (segment.index() + 1),
                            "reference", file == null ? null : file.toString(), startMs, endMs));
                }
                case "technique" -> {
                    String id = required(ref, "techniqueId", kind);
                    FxTechnique technique = techniques.require(id);
                    String intent = ref.path("intent").asText("reference");
                    lines.add(describeTechnique(technique, intent));
                    resolved.add(new ResolvedResource("technique", id, technique.name(),
                            intent, null, null, null));
                }
                default -> {
                    /* 其它 kind（project/scene/frame 等）不属于三库，
                       由原有链路处理，这里不管 —— 但要说清不是被静默丢掉。 */
                }
            }
        }

        if (lines.isEmpty()) {
            return ResourceContext.EMPTY;
        }
        return new ResourceContext(true, String.join("\n", lines), List.copyOf(resolved));
    }

    /**
     * 取必填字段。
     *
     * @param ref  引用节点
     * @param field 字段名
     * @param kind  资源类型（用于报错信息）
     * @return 值
     */
    private String required(JsonNode ref, String field, String kind) {
        String value = ref.path(field).asText("");
        if (value.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "reference_invalid",
                    "引用了" + kindLabel(kind) + "但没有给出 " + field + "：无法确定用户指的是哪一项");
        }
        return value;
    }

    /**
     * 把素材记录解析成 agent 可打开的绝对路径。
     *
     * <p><strong>为什么必须在这里做</strong>：库里存的是相对存储根的路径，
     * API 返回给前端的是 {@code /api/assets/{id}/content} —— 两种形式 agent 都拿不到文件。
     * agent 的工作目录是项目目录，只有绝对路径它才读得到。</p>
     *
     * @param asset 素材
     * @return 绝对路径
     * @throws ApiException 文件已丢失时
     */
    private Path absoluteAssetPath(Asset asset) {
        try {
            Path file = storage.resolve(asset.fileUrl());
            if (!Files.isRegularFile(file)) {
                throw new ApiException(HttpStatus.NOT_FOUND, "asset_file_missing",
                        "素材「" + asset.name() + "」的文件已不在库中，无法交给 agent 使用");
            }
            return file;
        } catch (IllegalArgumentException ex) {
            throw new ApiException(HttpStatus.NOT_FOUND, "asset_file_missing",
                    "素材「" + asset.name() + "」的存储路径无效：" + ex.getMessage());
        }
    }

    /**
     * 把参考片解析成 agent 可打开的绝对视频路径。
     *
     * <p>没有关联素材（或素材文件已丢）的参考片只能给出口头描述：
     * 这时<strong>不能声称「可以去看这段视频」</strong>，否则 agent 会去找一个不存在的文件。</p>
     *
     * @param video 参考片
     * @return 绝对路径；本机没有文件时为 null
     */
    private Path absoluteReferencePath(ReferenceVideo video) {
        if (!video.playable()) {
            return null;
        }
        try {
            Asset asset = assets.require(video.assetId());
            Path file = storage.resolve(asset.fileUrl());
            return Files.isRegularFile(file) ? file : null;
        } catch (RuntimeException ex) {
            log.warn("参考片 {} 关联素材不可用：{}", video.id(), ex.getMessage());
            return null;
        }
    }

    /**
     * 描述一份素材。
     *
     * @param asset   素材
     * @param file    绝对文件路径
     * @param purpose 用途
     * @param note    用户补充说明
     * @return 一行描述
     */
    private String describeAsset(Asset asset, Path file, String purpose, String note) {
        String use = switch (purpose) {
            case "visual" -> "用作画面素材（应当出现在成片里）";
            case "reference" -> "仅参考其风格/构图，不要直接放进成片";
            case "audio" -> "用作音频（配乐或声音素材）";
            case "information" -> "仅作为资料参考，不要出现在画面里";
            default -> "用途未指定（请询问用户，不要自行假定要放进画面）";
        };
        StringBuilder sb = new StringBuilder();
        sb.append("- 素材「").append(asset.name()).append("」：").append(use).append('\n');
        sb.append("  文件路径：").append(file).append("（").append(asset.mimeType()).append("）\n");
        if (!note.isBlank()) sb.append("  用户说明：").append(note).append('\n');
        return sb.toString().stripTrailing();
    }

    /**
     * 描述一段参考片。
     *
     * <p>把「看哪里」「看哪一段」「要借鉴什么」「别人的观察」四件事一次说清：
     * 只说「参考片第 2 段」时，agent 既不知道文件在哪，也不知道这段里有什么，
     * 最后大概率靠猜 —— 猜出来的不是给人看的工程。</p>
     *
     * @param video   参考片
     * @param file    绝对文件路径；本机无文件时为 null
     * @param segment 片段记录（带人工观察与推断）
     * @param startMs 起始毫秒
     * @param endMs   结束毫秒
     * @param wants   想借鉴什么
     * @param avoid   要避开什么
     * @return 一段描述
     */
    private String describeReference(ReferenceVideo video, Path file, ReferenceSegment segment,
                                     long startMs, long endMs, String wants, String avoid) {
        StringBuilder sb = new StringBuilder();
        sb.append("- 参考片「").append(video.title()).append("」第 ").append(segment.index() + 1)
          .append(" 段（").append(seconds(startMs)).append(" – ").append(seconds(endMs)).append("）：")
          .append("借鉴这一段的手法，不要直接使用它的画面\n");
        if (file != null) {
            sb.append("  视频文件：").append(file).append('\n');
            sb.append("  要看的区间：").append(seconds(startMs)).append(" 到 ").append(seconds(endMs))
              .append("（只观察这一段；需要时可抽帧查看，但成片里不得出现该文件的任何画面）\n");
        } else {
            sb.append("  本机没有这条参考片的视频文件，无法直接观看；")
              .append("以下是已有的人工观察，请据此理解这一段，不要假装看过画面\n");
        }
        if (!wants.isBlank()) sb.append("  想借鉴：").append(wants).append('\n');
        if (!avoid.isBlank()) sb.append("  要避开：").append(avoid).append('\n');

        /* 人工观察与模型推断分开放：合并成一句，agent 会把推断当事实写进工程。
           契约（library.md §4.2）要求两者分开呈现，这里对 agent 同样适用。 */
        String observation = segment.observation();
        if (observation != null && !observation.isBlank()) {
            sb.append("  人工观察（已确认看到的内容）：").append(truncate(observation, 400)).append('\n');
        }
        String inference = segment.inference();
        if (inference != null && !inference.isBlank()) {
            sb.append("  模型推断（未经确认，只能作参考，不要当事实照搬）：")
              .append(truncate(inference, 300)).append('\n');
        }
        String suggestion = segment.suggestion();
        if (suggestion != null && !suggestion.isBlank()) {
            sb.append("  既有用法建议：").append(truncate(suggestion, 300)).append('\n');
        }
        return sb.toString().stripTrailing();
    }

    /**
     * 描述一个特效技法。
     *
     * @param technique 技法
     * @param intent    意图
     * @return 一行描述
     */
    private String describeTechnique(FxTechnique technique, String intent) {
        String use = switch (intent) {
            case "apply" -> "按这种技法实现";
            default -> "仅作技法参考，不要求完全照做";
        };
        StringBuilder sb = new StringBuilder();
        sb.append("- 特效「").append(technique.name()).append("」：").append(use).append('\n');
        if (technique.intent() != null && !technique.intent().isBlank()) {
            sb.append("  适用意图：").append(technique.intent()).append('\n');
        }
        if (technique.output() != null && !technique.output().isBlank()) {
            sb.append("  产出：").append(truncate(technique.output(), 200)).append('\n');
        }
        if (technique.steps() != null && !technique.steps().isEmpty()) {
            sb.append("  做法步骤：").append(truncate(String.join("；", technique.steps()), 300)).append('\n');
        }
        return sb.toString().stripTrailing();
    }

    /**
     * 毫秒转可读秒数。
     *
     * @param ms 毫秒
     * @return 如 "1.5s"
     */
    private String seconds(long ms) {
        return String.format("%.1fs", ms / 1000.0);
    }

    /**
     * 截断过长文本。
     *
     * @param text 文本
     * @param max  上限
     * @return 截断结果
     */
    private String truncate(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max) + "…";
    }

    /**
     * 类型的中文名，用于报错。
     *
     * @param kind 类型
     * @return 中文名
     */
    private String kindLabel(String kind) {
        return switch (kind) {
            case "asset" -> "素材";
            case "reference" -> "参考片";
            case "technique" -> "特效";
            default -> kind;
        };
    }

    /**
     * 已解析的一条资源。
     *
     * @param kind      类型
     * @param id        资源 ID
     * @param label     人类可读名称
     * @param usage     用途
     * @param path      文件相对路径（素材）
     * @param startMs   起始毫秒（参考片）
     * @param endMs     结束毫秒（参考片）
     */
    public record ResolvedResource(String kind, String id, String label, String usage,
                                   String path, Long startMs, Long endMs) {
    }

    /**
     * 资源上下文。
     *
     * @param available  是否含三库资源
     * @param description 给 agent 读的文字描述
     * @param resolved   已解析的资源清单（用于日志与核对）
     */
    public record ResourceContext(boolean available, String description, List<ResolvedResource> resolved) {
        /** 空上下文。 */
        public static final ResourceContext EMPTY =
                new ResourceContext(false, "", List.of());
    }
}
