package com.fengmotion.server.reference.store;

import java.util.List;
import java.util.Optional;

import com.fengmotion.server.reference.domain.ReferenceCollection;
import com.fengmotion.server.reference.domain.ReferenceSegment;
import com.fengmotion.server.reference.domain.ReferenceStates;
import com.fengmotion.server.reference.domain.ReferenceVideo;

/**
 * 参考片库持久化边界。
 *
 * <p>服务层只依赖本接口：分析口径（observation / inference 分离、pending 不填默认值）
 * 等规则集中在服务层与领域对象里，换存储实现不会牵动业务判断。</p>
 */
public interface ReferenceRepository {

    /** 视频列表查询。 */
    record VideoQuery(
            ReferenceStates.Status status,
            String tag,
            String q,
            int limit,
            int offset) {
    }

    /** 片段列表查询。 */
    record SegmentQuery(
            String videoId,
            ReferenceStates.Status status,
            String tag,
            String q,
            int limit,
            int offset) {
    }

    // ── 视频 ──

    ReferenceVideo saveVideo(ReferenceVideo video);

    ReferenceVideo updateVideo(ReferenceVideo video);

    Optional<ReferenceVideo> findVideo(String id);

    /** 按素材反查参考片：同一个视频不该被重复登记成两条参考片。 */
    Optional<ReferenceVideo> findVideoByAsset(String assetId);

    boolean deleteVideo(String id);

    List<ReferenceVideo> searchVideos(VideoQuery query);

    int countVideos(VideoQuery query);

    int countAllVideos();

    void updateVideoStatus(String id, ReferenceStates.Status status);

    // ── 片段 ──

    ReferenceSegment saveSegment(ReferenceSegment segment);

    ReferenceSegment updateSegment(ReferenceSegment segment);

    Optional<ReferenceSegment> findSegment(String id);

    boolean deleteSegment(String id);

    List<ReferenceSegment> findSegmentsByVideo(String videoId);

    int countSegmentsByVideo(String videoId);

    /** 该视频下一个可用序号（切片时避免 UNIQUE 冲突）。 */
    int nextSegmentIndex(String videoId);

    List<ReferenceSegment> searchSegments(SegmentQuery query);

    int countSegments(SegmentQuery query);

    // ── 集合 ──

    ReferenceCollection saveCollection(ReferenceCollection collection);

    ReferenceCollection updateCollection(ReferenceCollection collection);

    Optional<ReferenceCollection> findCollection(String id);

    boolean deleteCollection(String id);

    List<ReferenceCollection> listCollections();

    // ── 偏好（工作区级，跨项目共享）──

    void favorite(String segmentId, boolean favorited);

    void touchRecent(String segmentId);

    List<String> favorites();

    List<String> recent();
}
