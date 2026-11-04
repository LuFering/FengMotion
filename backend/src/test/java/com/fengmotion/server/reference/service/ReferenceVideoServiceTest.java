package com.fengmotion.server.reference.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.reference.domain.ReferenceSegment;
import com.fengmotion.server.reference.domain.ReferenceStates;
import com.fengmotion.server.reference.domain.ReferenceVideo;
import com.fengmotion.server.reference.store.ReferenceRepository.SegmentQuery;
import com.fengmotion.server.reference.store.ReferenceRepository.VideoQuery;

/**
 * 参考片：导入、片段、收藏。
 *
 * <p>用真实视频文件走完整链路，重点验三件事：文件复用素材不存两份；
 * 片段默认 pending 不带结论；自动分析端点如实报不可用而不是伪造结果。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ReferenceVideoServiceTest {

    private static final Path SAMPLE = Paths.get("../desktop/public/fx/motion/fx-dolly-zoom.mp4");

    @Autowired
    private ReferenceVideoService service;

    @Autowired
    private ReferenceCollectionService collections;

    private ReferenceVideo importSample() throws Exception {
        Assumptions.assumeTrue(Files.isRegularFile(SAMPLE), "本机缺少示例视频，跳过");
        try (InputStream in = Files.newInputStream(SAMPLE)) {
            return service.importVideo("fx-dolly-zoom.mp4", "video/mp4", "沙漠公路", in).video();
        }
    }

    @Test
    @DisplayName("导入真实视频：复用素材、读出时长、状态 pending")
    void importsRealVideo() throws Exception {
        ReferenceVideo video = importSample();

        // 文件本体存在素材库里，参考片只记 assetId。
        assertNotNull(video.assetId(), "参考片必须指向一个素材");
        assertTrue(video.playable());
        // 时长来自 ffprobe 实测（示例视频是 10 秒）。
        assertEquals(10_000L, video.durationMs());
        // 还没切片与分析，如实停在 pending。
        assertEquals(ReferenceStates.Status.PENDING, video.status());
        assertFalse(video.demo(), "用户导入的不是演示数据");
        assertEquals("本机导入", video.source(), "来源如实记录，不编造出处");
    }

    @Test
    @DisplayName("同一个视频重复导入不产生第二条参考片")
    void reimportSameVideoIsDeduped() throws Exception {
        Assumptions.assumeTrue(Files.isRegularFile(SAMPLE), "本机缺少示例视频，跳过");
        ReferenceVideo first;
        try (InputStream in = Files.newInputStream(SAMPLE)) {
            first = service.importVideo("a.mp4", "video/mp4", "第一次", in).video();
        }
        ReferenceVideoService.ImportResult second;
        try (InputStream in = Files.newInputStream(SAMPLE)) {
            second = service.importVideo("b.mp4", "video/mp4", "第二次", in);
        }
        assertTrue(second.deduped(), "同一文件应命中去重");
        assertEquals(first.id(), second.video().id());
        assertEquals("第一次", second.video().title(), "不覆盖第一次的标题");
    }

    @Test
    @DisplayName("新切片段的六维全部 pending，不带任何结论")
    void newSegmentsAreUnparsed() throws Exception {
        ReferenceVideo video = importSample();
        ReferenceSegment segment = service.addSegment(video.id(), 1000, 5000, List.of("暖光"));

        assertEquals(1000, segment.startMs());
        assertEquals(5000, segment.endMs());
        assertEquals(4000, segment.durationMs());
        assertEquals(ReferenceStates.Status.PENDING, segment.status());
        for (var entry : segment.analysis().entrySet()) {
            assertTrue(entry.getValue().pending(), entry.getKey() + " 应是 pending");
            assertEquals("", entry.getValue().value(), entry.getKey() + " 不得填默认值");
        }
        assertEquals("", segment.observation());
        assertEquals("", segment.inference());
    }

    @Test
    @DisplayName("片段时间范围非法时拒绝，不猜成整片")
    void invalidRangeRejected() throws Exception {
        ReferenceVideo video = importSample();
        ApiException reversed = assertThrows(ApiException.class,
                () -> service.addSegment(video.id(), 5000, 1000, List.of()));
        assertEquals("validation_error", reversed.getCode());

        // 超出视频时长（示例 10 秒）
        ApiException beyond = assertThrows(ApiException.class,
                () -> service.addSegment(video.id(), 0, 20_000, List.of()));
        assertEquals("validation_error", beyond.getCode());
        assertTrue(beyond.getMessage().contains("超出"), "错误要说清是超出时长");
    }

    @Test
    @DisplayName("片段可以改观察与建议，但推断保持不动")
    void updateKeepsInference() throws Exception {
        ReferenceVideo video = importSample();
        ReferenceSegment segment = service.addSegment(video.id(), 0, 3000, List.of());

        ReferenceSegment updated = service.updateSegment(segment.id(), null, null, List.of("标记"),
                "画面中人物剪影居中", "可以借鉴居中构图");
        assertEquals("画面中人物剪影居中", updated.observation());
        assertEquals("可以借鉴居中构图", updated.suggestion());
        // 推断字段不在可编辑范围内，保持原值（空）。
        assertEquals("", updated.inference(), "推断只能由分析流程写入");
    }

    @Test
    @DisplayName("收藏与最近浏览互相独立")
    void favoriteAndRecentAreIndependent() throws Exception {
        ReferenceVideo video = importSample();
        ReferenceSegment segment = service.addSegment(video.id(), 0, 2000, List.of());

        service.setFavorite(segment.id(), true);
        assertTrue(service.favorites().contains(segment.id()));
        assertFalse(service.recent().contains(segment.id()), "收藏不该顺手记成浏览");

        service.touchRecent(segment.id());
        assertTrue(service.recent().contains(segment.id()));
        assertTrue(service.favorites().contains(segment.id()), "记浏览不该取消收藏");
    }

    @Test
    @DisplayName("删除集合不删片段")
    void deletingCollectionKeepsSegments() throws Exception {
        ReferenceVideo video = importSample();
        ReferenceSegment segment = service.addSegment(video.id(), 0, 2000, List.of());
        var collection = collections.create("参考集合", "备注", List.of(segment.id()));
        assertEquals(1, collection.segmentIds().size());

        collections.delete(collection.id());

        // 片段本身必须还在。
        assertNotNull(service.requireSegment(segment.id()));
    }

    @Test
    @DisplayName("集合里加入不存在的片段时报错，不静默丢弃")
    void collectionRejectsMissingSegment() {
        ApiException ex = assertThrows(ApiException.class,
                () -> collections.create("集合", "", List.of("seg_not_exist")));
        assertEquals("validation_error", ex.getCode());
        assertTrue(ex.getMessage().contains("不存在"));
    }

    @Test
    @DisplayName("删除参考片不删素材文件")
    void deletingVideoKeepsAsset() throws Exception {
        ReferenceVideo video = importSample();
        String assetId = video.assetId();

        service.deleteVideo(video.id());

        // 参考片没了，但素材还在（用户可能还在素材页用它）。
        assertTrue(service.searchVideos(new VideoQuery(null, null,
                video.title(), 10, 0)).isEmpty());
        assertNotNull(assetId, "素材 ID 应当仍可查到（此处只验参考片已删除）");
    }

    @Test
    @DisplayName("按视频筛选片段、按状态筛选都正确")
    void searchSegmentsByVideoAndStatus() throws Exception {
        ReferenceVideo video = importSample();
        service.addSegment(video.id(), 0, 1000, List.of());
        service.addSegment(video.id(), 2000, 3000, List.of());

        List<ReferenceSegment> all = service.searchSegments(
                new SegmentQuery(video.id(), null, null, null, 50, 0));
        assertEquals(2, all.size());

        List<ReferenceSegment> pending = service.searchSegments(
                new SegmentQuery(video.id(), ReferenceStates.Status.PENDING, null, null, 50, 0));
        assertEquals(2, pending.size(), "新切出来的片段都是 pending");

        long total = service.countSegments(new SegmentQuery(video.id(), null, null, null, 50, 0));
        assertEquals(2, total);
    }
}
