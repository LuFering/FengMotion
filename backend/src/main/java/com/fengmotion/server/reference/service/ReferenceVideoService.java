package com.fengmotion.server.reference.service;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.asset.domain.AssetStates;
import com.fengmotion.server.asset.service.AssetService;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.reference.domain.ReferenceSegment;
import com.fengmotion.server.reference.domain.ReferenceStates;
import com.fengmotion.server.reference.domain.ReferenceVideo;
import com.fengmotion.server.reference.store.ReferenceRepository;
import com.fengmotion.server.reference.store.ReferenceRepository.SegmentQuery;
import com.fengmotion.server.reference.store.ReferenceRepository.VideoQuery;

/**
 * 参考片：视频导入、片段管理、播放信息。
 *
 * <p><strong>文件本体复用素材库</strong>：导入参考片时先把文件存成素材，参考片只记
 * {@code assetId}。同一个视频不该在为「素材」和「参考」各存一份 —— 那样删除、
 * 备份、去重都会变成两套逻辑。</p>
 *
 * <p>本阶段**不做自动分析**。切分与观察都由用户手工完成，分析维度停在 pending。
 * 这是刻意的：自动切分与视频理解需要单独的模型能力与验收，先让参考片库成为一个
 * 「能导入、能播、能标、能整理」的真实可用的库，比一个半自动的半成品更有价值。</p>
 */
@Service
public class ReferenceVideoService {

    private final ReferenceRepository repository;
    private final AssetService assets;

    public ReferenceVideoService(ReferenceRepository repository, AssetService assets) {
        this.repository = repository;
        this.assets = assets;
    }

    /** 导入结果。 */
    public record ImportResult(ReferenceVideo video, boolean deduped) {
    }

    /**
     * 导入一个视频作为参考片。
     *
     * <p>同一个文件重复导入时返回已有参考片（按素材反查），不新建 ——
     * 用户拖同一个视频两次，不该在库里出现两条一模一样的参考片。</p>
     *
     * @param fileName 原始文件名
     * @param mimeType MIME
     * @param title    标题；为空时用文件名
     * @param stream   文件内容
     */
    @Transactional
    public ImportResult importVideo(String fileName, String mimeType, String title, InputStream stream) {
        AssetService.ImportResult assetResult = assets.importFile(fileName, mimeType, null, fileName, stream);
        Asset asset = assetResult.asset();

        if (asset.mediaType() != AssetStates.MediaType.VIDEO) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "参考片只接受视频文件；图片与音频请导入素材库");
        }

        var existing = repository.findVideoByAsset(asset.id());
        if (existing.isPresent()) {
            return new ImportResult(existing.get(), true);
        }

        Instant now = Instant.now();
        ReferenceVideo video = new ReferenceVideo(
                "ref_" + UUID.randomUUID(),
                title == null || title.isBlank() ? fileName : title,
                asset.durationMs() == null ? 0L : asset.durationMs(),
                // 来源如实记录：本机导入的文件，不编造「AI 生成」这类出处。
                "本机导入",
                "",
                List.of(),
                asset.id(),
                asset.thumbnailUrl() == null ? null : "/api/assets/" + asset.id() + "/thumbnail",
                // 还没有切片与分析，如实停在 pending。
                ReferenceStates.Status.PENDING,
                now,
                now,
                false);
        return new ImportResult(repository.saveVideo(video), false);
    }

    public ReferenceVideo requireVideo(String id) {
        return repository.findVideo(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "参考片不存在"));
    }

    public List<ReferenceVideo> searchVideos(VideoQuery query) {
        return repository.searchVideos(query);
    }

    public int countVideos(VideoQuery query) {
        return repository.countVideos(query);
    }

    public int totalVideos() {
        return repository.countAllVideos();
    }

    /**
     * 更新参考片元信息（标题、描述、标签）。
     *
     * <p>不改 {@code assetId}：换文件等于换了一条参考片，应当重新导入而不是原地替换 ——
     * 否则已切好的片段会指向错误的画面。</p>
     */
    @Transactional
    public ReferenceVideo updateVideo(String id, String title, String description, List<String> tags) {
        ReferenceVideo current = requireVideo(id);
        ReferenceVideo updated = new ReferenceVideo(
                current.id(),
                title == null ? current.title() : title,
                current.durationMs(),
                current.source(),
                description == null ? current.description() : description,
                tags == null ? current.tags() : tags,
                current.assetId(),
                current.thumbnailUrl(),
                current.status(),
                current.createdAt(),
                Instant.now(),
                current.demo());
        return repository.updateVideo(updated);
    }

    /**
     * 删除参考片。
     *
     * <p>只删参考片记录与它的片段，<strong>不删素材文件</strong> —— 用户在素材库里
     * 可能还在用它。要删文件请去素材库，那里有引用检查。</p>
     */
    @Transactional
    public void deleteVideo(String id) {
        requireVideo(id);
        repository.deleteVideo(id);
    }

    public List<ReferenceSegment> segmentsOf(String videoId) {
        return repository.findSegmentsByVideo(videoId);
    }

    public List<ReferenceSegment> searchSegments(SegmentQuery query) {
        return repository.searchSegments(query);
    }

    public int countSegments(SegmentQuery query) {
        return repository.countSegments(query);
    }

    public ReferenceSegment requireSegment(String id) {
        return repository.findSegment(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "片段不存在"));
    }

    /**
     * 新增一个片段。
     *
     * <p>时间范围必须合法（起点 < 终点，且不超过视频时长）。范围非法时不猜「那就算全片」，
     * 直接拒绝 —— 猜出来的片段会让用户以为切对了。</p>
     */
    @Transactional
    public ReferenceSegment addSegment(String videoId, long startMs, long endMs, List<String> tags) {
        ReferenceVideo video = requireVideo(videoId);
        if (startMs < 0 || endMs <= startMs) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "片段范围无效：起点必须小于终点");
        }
        if (video.durationMs() > 0 && endMs > video.durationMs()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "片段终点超出视频时长（" + video.durationMs() + "ms）");
        }
        int index = repository.nextSegmentIndex(videoId);
        ReferenceSegment segment = ReferenceSegment.unparsed(
                "seg_" + UUID.randomUUID(), videoId, index, startMs, endMs, tags);
        return repository.saveSegment(segment);
    }

    /**
     * 更新片段的用户内容（标签、观察、建议、时间范围）。
     *
     * <p><strong>不改 {@code inference}</strong>：那是模型推断，只能由分析流程写入。
     * 允许用户手工改推断，等于允许把人的猜测伪装成模型结论。</p>
     */
    @Transactional
    public ReferenceSegment updateSegment(String id, Long startMs, Long endMs, List<String> tags,
            String observation, String suggestion) {
        ReferenceSegment current = requireSegment(id);
        long newStart = startMs == null ? current.startMs() : startMs;
        long newEnd = endMs == null ? current.endMs() : endMs;
        if (newStart < 0 || newEnd <= newStart) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "片段范围无效：起点必须小于终点");
        }
        ReferenceVideo video = requireVideo(current.videoId());
        if (video.durationMs() > 0 && newEnd > video.durationMs()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "片段终点超出视频时长（" + video.durationMs() + "ms）");
        }
        ReferenceSegment updated = new ReferenceSegment(
                current.id(),
                current.videoId(),
                current.index(),
                newStart,
                newEnd,
                current.status(),
                tags == null ? current.tags() : tags,
                observation == null ? current.observation() : observation,
                // 推断保持原样，见方法注释。
                current.inference(),
                suggestion == null ? current.suggestion() : suggestion,
                current.analysis(),
                current.extraAnalysis(),
                current.createdAt(),
                Instant.now());
        return repository.updateSegment(updated);
    }

    /** 删除片段。 */
    @Transactional
    public void deleteSegment(String id) {
        requireSegment(id);
        repository.deleteSegment(id);
    }

    /** 记录一次「查看片段」；失败不抛，浏览记录不该阻断用户。 */
    @Transactional
    public void touchRecent(String segmentId) {
        if (repository.findSegment(segmentId).isEmpty()) {
            return;
        }
        repository.touchRecent(segmentId);
    }

    /** 收藏/取消收藏。收藏只是个人标记，不代表「已采用」。 */
    @Transactional
    public void setFavorite(String segmentId, boolean favorited) {
        requireSegment(segmentId);
        repository.favorite(segmentId, favorited);
    }

    public List<String> favorites() {
        return repository.favorites();
    }

    public List<String> recent() {
        return repository.recent();
    }
}
