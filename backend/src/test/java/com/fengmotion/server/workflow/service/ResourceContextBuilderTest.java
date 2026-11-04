package com.fengmotion.server.workflow.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.asset.service.AssetService;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.fx.domain.FxStates;
import com.fengmotion.server.fx.domain.FxTechnique;
import com.fengmotion.server.fx.service.FxTechniqueService;
import com.fengmotion.server.reference.domain.ReferenceSegment;
import com.fengmotion.server.reference.domain.ReferenceStates;
import com.fengmotion.server.reference.domain.ReferenceVideo;
import com.fengmotion.server.reference.service.ReferenceVideoService;

/**
 * 三库资源进入创作时的用途传达。
 *
 * <p>这组测试盯的是「资源 ID、用途、参考片时间范围是否准确传到 agent」。
 * 三者的用途完全不同，压成同一个文件路径或同一个 ID 列表，
 * agent 只能猜；猜错就会把「只想借鉴」的素材直接放进画面。</p>
 */
@DisplayName("资源上下文")
class ResourceContextBuilderTest {

    private final ObjectMapper json = new ObjectMapper();

    /**
     * 造一个 builder，素材/技法/参考片都用固定假数据。
     *
     * @return builder
     */
    private ResourceContextBuilder builder() {
        AssetService assets = new AssetService(null, null, null, null) {
            @Override
            public Asset require(String id) {
                if (!"asset-1".equals(id)) throw new ApiException(org.springframework.http.HttpStatus.NOT_FOUND,
                        "not_found", "素材不存在：" + id);
                return asset();
            }
        };
        FxTechniqueService techniques = new FxTechniqueService(null) {
            @Override
            public FxTechnique require(String id) {
                if (!"fx-1".equals(id)) throw new ApiException(org.springframework.http.HttpStatus.NOT_FOUND,
                        "not_found", "技法不存在：" + id);
                return technique();
            }
        };
        ReferenceVideoService references = new ReferenceVideoService(null, null, null) {
            @Override
            public ReferenceSegment requireSegment(String id) {
                if (!"seg-1".equals(id)) throw new ApiException(org.springframework.http.HttpStatus.NOT_FOUND,
                        "not_found", "片段不存在：" + id);
                return segment();
            }
            @Override
            public ReferenceVideo requireVideo(String id) {
                return video();
            }
        };
        return new ResourceContextBuilder(assets, techniques, references);
    }

    private Asset asset() {
        return new Asset("asset-1", "海边的黄昏.jpg",
                com.fengmotion.server.asset.domain.AssetStates.MediaType.IMAGE,
                "image/jpeg", 102400L,
                com.fengmotion.server.asset.domain.AssetStates.SourceType.IMPORTED,
                com.fengmotion.server.asset.domain.AssetStates.ProcessingStatus.READY,
                null,
                com.fengmotion.server.asset.domain.AssetStates.ReviewStatus.NONE,
                com.fengmotion.server.asset.domain.AssetStates.Availability.ENABLED,
                com.fengmotion.server.asset.domain.AssetStates.LicenseStatus.UNKNOWN,
                null, 1920, 1080, null, List.of(), null,
                "/api/assets/asset-1/content", null, "hash",
                Instant.now(), Instant.now(), null, "etag", false);
    }

    /**
     * 用 JSON 反序列化构造技法。
     *
     * <p>这个记录有 35 个字段，手工对齐容易写错且下次加字段就断；
     * 反序列化只关心我们真正会读的那几个。</p>
     *
     * @return 技法
     */
    private FxTechnique technique() {
        try {
            return json.readValue("""
                    {"id":"fx-1","name":"多莉变焦","nameEn":"Dolly Zoom","aliases":[],"keywords":["推拉"],
                     "intent":"制造心理不安","category":"camera","categoryLabel":"运镜",
                     "scenes":[],"antiScenes":[],"execType":"runnable","execLabel":"可直接执行",
                     "executionStatus":"declared","impl":"offline","implLabel":"离线","complexity":2,
                     "inputKinds":[],"inputLabels":[],"output":"一段反差镜头",
                     "dependencies":[],"steps":["先固定机位","再反向推轨"],
                     "compatibility":[],"limitations":[],"failures":[],"params":[],
                     "related":[],"alternatives":[],"version":"1.0","demo":false}
                    """, FxTechnique.class);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private ReferenceVideo video() {
        return new ReferenceVideo("video-1", "参考广告片", 30000L, "/refs/ad.mp4",
                null, List.of(), "asset-v", null,
                ReferenceStates.Status.ANALYZED, Instant.now(), Instant.now(), false);
    }

    private ReferenceSegment segment() {
        return new ReferenceSegment("seg-1", "video-1", 1, 5000L, 9000L,
                ReferenceStates.Status.ANALYZED, List.of(), null, null, null,
                java.util.Map.of(), java.util.Map.of(), Instant.now(), Instant.now());
    }

    @Test
    @DisplayName("素材：画面用途与仅参考用途必须措辞不同")
    void assetPurposeChangesWording() throws Exception {
        var visual = builder().build(json.readTree("""
                [{"kind":"asset","assetId":"asset-1","purpose":"visual","label":"海边"}]
                """));
        var reference = builder().build(json.readTree("""
                [{"kind":"asset","assetId":"asset-1","purpose":"reference","label":"海边"}]
                """));

        assertTrue(visual.description().contains("应当出现在成片里"), visual.description());
        assertTrue(reference.description().contains("不要直接放进成片"), reference.description());
        assertFalse(visual.description().equals(reference.description()),
                "同一素材不同用途必须给出不同指令");
    }

    @Test
    @DisplayName("素材：未指定用途时要求询问，不擅自当作画面素材")
    void assetWithoutPurposeAsks() throws Exception {
        var ctx = builder().build(json.readTree("""
                [{"kind":"asset","assetId":"asset-1","label":"海边"}]
                """));
        assertTrue(ctx.description().contains("用途未指定"), ctx.description());
        assertTrue(ctx.description().contains("不要自行假定"), ctx.description());
    }

    @Test
    @DisplayName("参考片：带上片段序号与秒级时间范围")
    void referenceCarriesTimeRange() throws Exception {
        var ctx = builder().build(json.readTree("""
                [{"kind":"reference","segmentId":"seg-1","videoId":"video-1","wants":"运镜节奏","avoid":"不要用它的画面","label":"参考"}]
                """));

        String d = ctx.description();
        assertTrue(d.contains("参考广告片"), d);
        assertTrue(d.contains("第 2 段"), "片段序号要能对上：" + d);
        assertTrue(d.contains("5.0s") && d.contains("9.0s"), "时间范围要准确：" + d);
        assertTrue(d.contains("运镜节奏"), d);
        assertTrue(d.contains("不要用它的画面"), d);
        assertEquals(5000L, ctx.resolved().get(0).startMs());
        assertEquals(9000L, ctx.resolved().get(0).endMs());
    }

    @Test
    @DisplayName("参考片：引用里的时间范围优先于片段默认值")
    void referencePrefersExplicitRange() throws Exception {
        var ctx = builder().build(json.readTree("""
                [{"kind":"reference","segmentId":"seg-1","startMs":6000,"endMs":7000,"label":"x"}]
                """));
        assertEquals(6000L, ctx.resolved().get(0).startMs());
        assertEquals(7000L, ctx.resolved().get(0).endMs());
        assertTrue(ctx.description().contains("6.0s"), ctx.description());
    }

    @Test
    @DisplayName("特效：apply 与 reference 两种意图措辞不同")
    void techniqueIntentChangesWording() throws Exception {
        var apply = builder().build(json.readTree("""
                [{"kind":"technique","techniqueId":"fx-1","intent":"apply","label":"多莉变焦"}]
                """));
        var ref = builder().build(json.readTree("""
                [{"kind":"technique","techniqueId":"fx-1","intent":"reference","label":"多莉变焦"}]
                """));

        assertTrue(apply.description().contains("按这种技法实现"), apply.description());
        assertTrue(ref.description().contains("仅作技法参考"), ref.description());
        assertTrue(apply.description().contains("先固定机位"), "要带上做法要点：" + apply.description());
    }

    @Test
    @DisplayName("资源 ID 查不到时明确报错，不静默跳过")
    void missingResourceFails() throws Exception {
        var e = assertThrows(ApiException.class, () -> builder().build(json.readTree("""
                [{"kind":"asset","assetId":"nope","label":"x"}]
                """)));
        assertEquals("not_found", e.getCode());
    }

    @Test
    @DisplayName("引用缺 ID 时报错，指出是哪一类资源")
    void missingIdFails() throws Exception {
        var e = assertThrows(ApiException.class, () -> builder().build(json.readTree("""
                [{"kind":"reference","label":"x"}]
                """)));
        assertEquals("reference_invalid", e.getCode());
        assertTrue(e.getMessage().contains("参考片"), e.getMessage());
    }

    @Test
    @DisplayName("没有三库资源时 available=false，不编造内容")
    void emptyWhenNoLibraryRefs() throws Exception {
        var ctx = builder().build(json.readTree("""
                [{"kind":"project","projectId":"p1","label":"整个项目"}]
                """));
        assertFalse(ctx.available());
        assertEquals("", ctx.description());
        assertTrue(ctx.resolved().isEmpty());
    }

    @Test
    @DisplayName("非三库引用（project/scene）不被当成资源，也不报错")
    void ignoresNonLibraryRefs() throws Exception {
        var ctx = builder().build(json.readTree("""
                [{"kind":"scene","sceneId":"s1","label":"第一幕"},
                 {"kind":"asset","assetId":"asset-1","purpose":"visual","label":"海边"}]
                """));
        assertTrue(ctx.available());
        assertEquals(1, ctx.resolved().size());
        assertEquals("asset", ctx.resolved().get(0).kind());
    }

    @Test
    @DisplayName("三类资源同时存在时都能解析出来")
    void handlesAllThree() throws Exception {
        var ctx = builder().build(json.readTree("""
                [{"kind":"asset","assetId":"asset-1","purpose":"visual","label":"海边"},
                 {"kind":"reference","segmentId":"seg-1","label":"参考"},
                 {"kind":"technique","techniqueId":"fx-1","intent":"apply","label":"多莉变焦"}]
                """));
        assertEquals(3, ctx.resolved().size());
        assertEquals(List.of("asset", "reference", "technique"),
                ctx.resolved().stream().map(ResourceContextBuilder.ResolvedResource::kind).toList());
    }
}
