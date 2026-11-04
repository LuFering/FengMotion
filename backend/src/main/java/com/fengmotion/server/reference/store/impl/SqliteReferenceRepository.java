package com.fengmotion.server.reference.store.impl;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.reference.domain.AnalysisValue;
import com.fengmotion.server.reference.domain.ReferenceCollection;
import com.fengmotion.server.reference.domain.ReferenceSegment;
import com.fengmotion.server.reference.domain.ReferenceStates;
import com.fengmotion.server.reference.domain.ReferenceVideo;
import com.fengmotion.server.reference.store.ReferenceRepository;
import com.fengmotion.server.reference.store.mapper.ReferenceCollectionMapper;
import com.fengmotion.server.reference.store.mapper.ReferenceCollectionMapper.CollectionRow;
import com.fengmotion.server.reference.store.mapper.ReferencePreferenceMapper;
import com.fengmotion.server.reference.store.mapper.ReferenceSegmentMapper;
import com.fengmotion.server.reference.store.mapper.ReferenceSegmentRow;
import com.fengmotion.server.reference.store.mapper.ReferenceVideoMapper;
import com.fengmotion.server.reference.store.mapper.ReferenceVideoRow;

/**
 * 参考片库持久化的 SQLite 实现。
 *
 * <p>分析值的 JSON 转换集中在这里，并且**在写出时就守住口径**：
 * pending 的维度写出空 value 与 null source，不会顺手填「未知」。</p>
 */
@Repository
public class SqliteReferenceRepository implements ReferenceRepository {

    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {
    };
    private static final TypeReference<Map<String, AnalysisValue>> ANALYSIS_MAP = new TypeReference<>() {
    };

    private final ReferenceVideoMapper videos;
    private final ReferenceSegmentMapper segments;
    private final ReferenceCollectionMapper collections;
    private final ReferencePreferenceMapper preferences;
    private final ObjectMapper json;

    public SqliteReferenceRepository(ReferenceVideoMapper videos, ReferenceSegmentMapper segments,
            ReferenceCollectionMapper collections, ReferencePreferenceMapper preferences, ObjectMapper json) {
        this.videos = videos;
        this.segments = segments;
        this.collections = collections;
        this.preferences = preferences;
        this.json = json;
    }

    // ── 视频 ──

    @Override
    public ReferenceVideo saveVideo(ReferenceVideo video) {
        ReferenceVideoRow row = toRow(video);
        videos.insert(row);
        return video;
    }

    @Override
    public ReferenceVideo updateVideo(ReferenceVideo video) {
        videos.update(toRow(video));
        return video;
    }

    @Override
    public Optional<ReferenceVideo> findVideo(String id) {
        return Optional.ofNullable(videos.findById(id)).map(this::toVideo);
    }

    @Override
    public Optional<ReferenceVideo> findVideoByAsset(String assetId) {
        return Optional.ofNullable(videos.findByAsset(assetId)).map(this::toVideo);
    }

    @Override
    public boolean deleteVideo(String id) {
        return videos.deleteById(id) > 0;
    }

    @Override
    public List<ReferenceVideo> searchVideos(VideoQuery q) {
        return videos.search(wire(q.status()), q.tag(), like(q.tag()), q.q(), like(q.q()),
                q.limit(), q.offset()).stream().map(this::toVideo).toList();
    }

    @Override
    public int countVideos(VideoQuery q) {
        return videos.count(wire(q.status()), q.tag(), like(q.tag()), q.q(), like(q.q()));
    }

    @Override
    public int countAllVideos() {
        return videos.countAll();
    }

    @Override
    public void updateVideoStatus(String id, ReferenceStates.Status status) {
        videos.updateStatus(id, status.wire(), Instant.now().toString());
    }

    // ── 片段 ──

    @Override
    public ReferenceSegment saveSegment(ReferenceSegment segment) {
        segments.insert(toRow(segment));
        return segment;
    }

    @Override
    public ReferenceSegment updateSegment(ReferenceSegment segment) {
        segments.update(toRow(segment));
        return segment;
    }

    @Override
    public Optional<ReferenceSegment> findSegment(String id) {
        return Optional.ofNullable(segments.findById(id)).map(this::toSegment);
    }

    @Override
    public boolean deleteSegment(String id) {
        return segments.deleteById(id) > 0;
    }

    @Override
    public List<ReferenceSegment> findSegmentsByVideo(String videoId) {
        return segments.findByVideo(videoId).stream().map(this::toSegment).toList();
    }

    @Override
    public int countSegmentsByVideo(String videoId) {
        return segments.countByVideo(videoId);
    }

    @Override
    public int nextSegmentIndex(String videoId) {
        return segments.nextIndex(videoId);
    }

    @Override
    public List<ReferenceSegment> searchSegments(SegmentQuery q) {
        return segments.search(q.videoId(), wire(q.status()), q.tag(), like(q.tag()), q.q(), like(q.q()),
                q.limit(), q.offset()).stream().map(this::toSegment).toList();
    }

    @Override
    public int countSegments(SegmentQuery q) {
        return segments.count(q.videoId(), wire(q.status()), q.tag(), like(q.tag()), q.q(), like(q.q()));
    }

    // ── 集合 ──

    @Override
    public ReferenceCollection saveCollection(ReferenceCollection collection) {
        CollectionRow row = new CollectionRow();
        row.setId(collection.id());
        row.setName(collection.name());
        row.setNote(collection.note());
        row.setCreatedAt(collection.createdAt().toString());
        row.setUpdatedAt(collection.updatedAt().toString());
        collections.insert(row);
        setMembers(collection.id(), collection.segmentIds());
        return collection;
    }

    @Override
    public ReferenceCollection updateCollection(ReferenceCollection collection) {
        CollectionRow row = new CollectionRow();
        row.setId(collection.id());
        row.setName(collection.name());
        row.setNote(collection.note());
        row.setCreatedAt(collection.createdAt().toString());
        row.setUpdatedAt(collection.updatedAt().toString());
        collections.update(row);
        setMembers(collection.id(), collection.segmentIds());
        return collection;
    }

    @Override
    public Optional<ReferenceCollection> findCollection(String id) {
        CollectionRow row = collections.findById(id);
        if (row == null) {
            return Optional.empty();
        }
        return Optional.of(toCollection(row));
    }

    @Override
    public boolean deleteCollection(String id) {
        // 成员关系随外键级联删除；片段本身保留。
        return collections.deleteById(id) > 0;
    }

    @Override
    public List<ReferenceCollection> listCollections() {
        return collections.findAll().stream().map(this::toCollection).toList();
    }

    private void setMembers(String collectionId, List<String> segmentIds) {
        collections.clearMembers(collectionId);
        String now = Instant.now().toString();
        for (String segmentId : segmentIds) {
            collections.addMember(collectionId, segmentId, now);
        }
    }

    // ── 偏好 ──

    @Override
    public void favorite(String segmentId, boolean favorited) {
        if (favorited) {
            preferences.mark(ReferencePreferenceMapper.KIND_FAVORITE, segmentId, Instant.now().toString());
        } else {
            preferences.unmark(ReferencePreferenceMapper.KIND_FAVORITE, segmentId);
        }
    }

    @Override
    public void touchRecent(String segmentId) {
        preferences.mark(ReferencePreferenceMapper.KIND_RECENT, segmentId, Instant.now().toString());
        // 契约 §5：最近浏览最多 50 条，按最近倒序。超出就裁掉，避免无限增长。
        preferences.trim(ReferencePreferenceMapper.KIND_RECENT, 50);
    }

    @Override
    public List<String> favorites() {
        return preferences.list(ReferencePreferenceMapper.KIND_FAVORITE);
    }

    @Override
    public List<String> recent() {
        return preferences.listLimited(ReferencePreferenceMapper.KIND_RECENT, 50);
    }

    // ── 转换 ──

    private ReferenceVideoRow toRow(ReferenceVideo v) {
        ReferenceVideoRow row = new ReferenceVideoRow();
        row.setId(v.id());
        row.setTitle(v.title());
        row.setDurationMs(v.durationMs());
        row.setSource(v.source());
        row.setDescription(v.description());
        row.setTagsJson(writeStrings(v.tags()));
        row.setAssetId(v.assetId());
        row.setThumbnailUrl(v.thumbnailUrl());
        row.setStatus(v.status().wire());
        row.setCreatedAt(v.createdAt().toString());
        row.setUpdatedAt(v.updatedAt().toString());
        row.setDemo(v.demo() ? 1 : 0);
        return row;
    }

    private ReferenceVideo toVideo(ReferenceVideoRow row) {
        return new ReferenceVideo(
                row.getId(),
                row.getTitle(),
                row.getDurationMs() == null ? 0 : row.getDurationMs(),
                row.getSource(),
                row.getDescription(),
                readStrings(row.getTagsJson()),
                row.getAssetId(),
                row.getThumbnailUrl(),
                ReferenceStates.Status.fromWire(row.getStatus()),
                parseInstant(row.getCreatedAt()),
                parseInstant(row.getUpdatedAt()),
                row.getDemo() != null && row.getDemo() == 1);
    }

    private ReferenceSegmentRow toRow(ReferenceSegment s) {
        ReferenceSegmentRow row = new ReferenceSegmentRow();
        row.setId(s.id());
        row.setVideoId(s.videoId());
        row.setIdx(s.index());
        row.setStartMs(s.startMs());
        row.setEndMs(s.endMs());
        row.setStatus(s.status().wire());
        row.setTagsJson(writeStrings(s.tags()));
        row.setObservation(s.observation());
        row.setInference(s.inference());
        row.setSuggestion(s.suggestion());
        row.setAnalysisJson(writeAnalysis(s.analysis()));
        row.setExtraAnalysisJson(s.extraAnalysis() == null || s.extraAnalysis().isEmpty()
                ? null
                : writeAnalysisLoose(s.extraAnalysis()));
        row.setCreatedAt(s.createdAt().toString());
        row.setUpdatedAt(s.updatedAt().toString());
        return row;
    }

    private ReferenceSegment toSegment(ReferenceSegmentRow row) {
        Map<ReferenceStates.AnalysisKey, AnalysisValue> analysis = readAnalysis(row.getAnalysisJson());
        // 六个维度必须齐全：库里缺了哪一维，补成 pending 而不是当作「没有这一维」。
        // 否则界面会少显示一行，看起来像「这一项不需要分析」。
        for (ReferenceStates.AnalysisKey key : ReferenceStates.AnalysisKey.ordered()) {
            analysis.putIfAbsent(key, AnalysisValue.unparsed());
        }
        return new ReferenceSegment(
                row.getId(),
                row.getVideoId(),
                row.getIdx() == null ? 0 : row.getIdx(),
                row.getStartMs() == null ? 0 : row.getStartMs(),
                row.getEndMs() == null ? 0 : row.getEndMs(),
                ReferenceStates.Status.fromWire(row.getStatus()),
                readStrings(row.getTagsJson()),
                row.getObservation() == null ? "" : row.getObservation(),
                row.getInference() == null ? "" : row.getInference(),
                row.getSuggestion() == null ? "" : row.getSuggestion(),
                analysis,
                row.getExtraAnalysisJson() == null ? Map.of() : readAnalysisLoose(row.getExtraAnalysisJson()),
                parseInstant(row.getCreatedAt()),
                parseInstant(row.getUpdatedAt()));
    }

    private ReferenceCollection toCollection(CollectionRow row) {
        return new ReferenceCollection(
                row.getId(),
                row.getName(),
                row.getNote(),
                collections.listMembers(row.getId()),
                parseInstant(row.getCreatedAt()),
                parseInstant(row.getUpdatedAt()));
    }

    /**
     * 序列化分析值。
     *
     * <p>以 wire 字符串为键（{@code cameraMove} 而不是枚举名），这样换实现或换语言时
     * 库里的数据仍然可读。pending 的值写空串 + null source，不填默认文案。</p>
     */
    private String writeAnalysis(Map<ReferenceStates.AnalysisKey, AnalysisValue> analysis) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (analysis != null) {
            for (var entry : analysis.entrySet()) {
                AnalysisValue v = entry.getValue();
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("value", v.pending() ? "" : v.value());
                item.put("source", v.pending() || v.source() == null ? null : v.source().wire());
                item.put("confidence", v.confidence());
                item.put("evidence", v.evidence() == null ? "" : v.evidence());
                item.put("pending", v.pending());
                out.put(entry.getKey().wire(), item);
            }
        }
        try {
            return json.writeValueAsString(out);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException("分析值序列化失败", ex);
        }
    }

    /** 额外维度是 String 键（后端可扩展，不绑定枚举），单独一条写出路径。 */
    private String writeAnalysisLoose(Map<String, AnalysisValue> analysis) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (var entry : analysis.entrySet()) {
            AnalysisValue v = entry.getValue();
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("value", v.pending() ? "" : v.value());
            item.put("source", v.pending() || v.source() == null ? null : v.source().wire());
            item.put("confidence", v.confidence());
            item.put("evidence", v.evidence() == null ? "" : v.evidence());
            item.put("pending", v.pending());
            out.put(entry.getKey(), item);
        }
        try {
            return json.writeValueAsString(out);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException("额外分析值序列化失败", ex);
        }
    }

    private Map<ReferenceStates.AnalysisKey, AnalysisValue> readAnalysis(String text) {
        Map<ReferenceStates.AnalysisKey, AnalysisValue> result = new LinkedHashMap<>();
        if (text == null || text.isBlank()) {
            return result;
        }
        try {
            Map<String, RawValue> raw = json.readValue(text, new TypeReference<>() {
            });
            for (var entry : raw.entrySet()) {
                ReferenceStates.AnalysisKey key = tryKey(entry.getKey());
                if (key != null) {
                    result.put(key, entry.getValue().toDomain());
                }
            }
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            // 单个片段的分析损坏不该让整个列表读不出来。
            return result;
        }
        return result;
    }

    private Map<String, AnalysisValue> readAnalysisLoose(String text) {
        Map<String, AnalysisValue> result = new LinkedHashMap<>();
        try {
            Map<String, RawValue> raw = json.readValue(text, new TypeReference<>() {
            });
            for (var entry : raw.entrySet()) {
                result.put(entry.getKey(), entry.getValue().toDomain());
            }
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            return result;
        }
        return result;
    }

    private static ReferenceStates.AnalysisKey tryKey(String wire) {
        for (ReferenceStates.AnalysisKey key : ReferenceStates.AnalysisKey.values()) {
            if (key.wire().equals(wire)) {
                return key;
            }
        }
        return null;
    }

    /** JSON 里的分析值；反序列化中转类型。 */
    @lombok.Data
    @lombok.NoArgsConstructor
    private static class RawValue {
        private String value;
        private String source;
        private Double confidence;
        private String evidence;
        private Boolean pending;

        AnalysisValue toDomain() {
            boolean isPending = pending != null && pending;
            return new AnalysisValue(
                    value == null ? "" : value,
                    isPending || source == null ? null : ReferenceStates.AnalysisSource.fromWire(source),
                    confidence,
                    evidence == null ? "" : evidence,
                    isPending);
        }
    }

    private static String wire(ReferenceStates.Status status) {
        return status == null ? null : status.wire();
    }

    /** LIKE 模式串：转义用户输入里的 % 与 _。 */
    private static String like(String raw) {
        if (raw == null) {
            return null;
        }
        return "%" + raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private String writeStrings(List<String> values) {
        try {
            return json.writeValueAsString(values == null ? List.of() : values);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException("序列化失败", ex);
        }
    }

    private List<String> readStrings(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        try {
            return json.readValue(text, STRING_LIST);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            return List.of();
        }
    }

    private static Instant parseInstant(String text) {
        return text == null ? Instant.EPOCH : Instant.parse(text);
    }

    /** 供诊断：把分析映射转成可读字符串。 */
    static List<String> describe(AnalysisValue value) {
        List<String> out = new ArrayList<>();
        out.add("value=" + value.value());
        out.add("pending=" + value.pending());
        return out;
    }
}
