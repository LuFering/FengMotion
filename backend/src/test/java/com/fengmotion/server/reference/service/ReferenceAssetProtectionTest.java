package com.fengmotion.server.reference.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.asset.service.AssetService;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.reference.domain.ReferenceVideo;

/**
 * 参考片对素材的删除保护。
 *
 * <p>参考片记录里存了 {@code assetId}，但素材删除检查看的是另一张 `resource_refs` 表。
 * 如果导入参考片时不登记引用，用户在素材库删掉这个文件会「成功」——
 * 参考片随即指向不存在的文件，表现为「视频打不开」且没有任何提示。</p>
 *
 * <p>这个测试就是盯着那条链路：导入参考片 → 尝试删素材 → 必须 409。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ReferenceAssetProtectionTest {

    private static final Path SAMPLE = Paths.get("../frontend/public/fx/motion/fx-dolly-zoom.mp4");

    @Autowired
    private ReferenceVideoService references;

    @Autowired
    private AssetService assets;

    @Test
    @DisplayName("参考片引用素材后，素材不能被删除")
    void assetUsedByReferenceCannotBeDeleted() throws Exception {
        Assumptions.assumeTrue(Files.isRegularFile(SAMPLE), "本机缺少示例视频，跳过");

        ReferenceVideo video;
        try (InputStream in = Files.newInputStream(SAMPLE)) {
            video = references.importVideo("protect.mp4", "video/mp4", "保护测试", in).video();
        }
        String assetId = video.assetId();

        // 关键断言：删除必须被拦下，并说明有引用。
        ApiException ex = assertThrows(ApiException.class, () -> assets.delete(assetId));
        assertEquals("asset_in_use", ex.getCode());
        assertEquals(409, ex.getStatus().value());
        assertTrue(ex.getMessage().contains("引用"), "错误信息要说明已被引用");
    }

    @Test
    @DisplayName("删掉参考片后，素材可以正常删除")
    void assetIsReusableAfterReferenceDeleted() throws Exception {
        Assumptions.assumeTrue(Files.isRegularFile(SAMPLE), "本机缺少示例视频，跳过");

        ReferenceVideo video;
        try (InputStream in = Files.newInputStream(SAMPLE)) {
            video = references.importVideo("release.mp4", "video/mp4", "释放测试", in).video();
        }
        String assetId = video.assetId();

        // 先确认被保护
        assertThrows(ApiException.class, () -> assets.delete(assetId));

        // 删掉参考片，引用应解除
        references.deleteVideo(video.id());

        // 现在素材可以删了（不抛异常即通过）
        assets.delete(assetId);
    }
}
