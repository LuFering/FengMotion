package com.fengmotion.server.asset.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * 缩略图与元数据探测。
 *
 * <p>关键取舍：探测失败必须返回 null / false，<strong>不能抛异常也不能造假</strong>。
 * 素材导入不该因为「读不出时长」而失败，界面也该如实显示「未知」而不是 0×0。</p>
 *
 * <p>依赖真实视频文件的用例在本机没有素材时会跳过（{@link Assumptions}），
 * 不会让 CI 变红，也不会假装通过。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
class ThumbnailServiceTest {

    /** 仓库里真实存在的示例视频，用于验证真实解码路径。 */
    private static final Path SAMPLE_VIDEO = Paths.get(
            "../frontend/public/fx/motion/fx-dolly-zoom.mp4");

    @Autowired
    private ThumbnailService thumbnails;

    @Test
    @DisplayName("ffmpeg 可用时能抽出真实缩略图")
    void extractsRealThumbnail() throws IOException {
        Assumptions.assumeTrue(Files.isRegularFile(SAMPLE_VIDEO), "本机缺少示例视频，跳过");
        Path target = Files.createTempFile("thumb-test-", ".webp");
        try {
            assertTrue(thumbnails.extractVideoThumbnail(SAMPLE_VIDEO, target), "应抽帧成功");
            assertTrue(Files.size(target) > 0, "缩略图不能是空文件");
        } finally {
            Files.deleteIfExists(target);
        }
    }

    @Test
    @DisplayName("ffprobe 能读出真实宽度、高度与时长")
    void probesRealMetadata() {
        Assumptions.assumeTrue(Files.isRegularFile(SAMPLE_VIDEO), "本机缺少示例视频，跳过");
        ThumbnailService.MediaInfo info = thumbnails.probe(SAMPLE_VIDEO);
        assertNotNull(info, "示例视频应能读到元数据");
        // 这个文件的实测值是 640x360 / 10s（ffprobe 已验证）。
        assertEquals(640, info.width());
        assertEquals(360, info.height());
        assertEquals(10_000L, info.durationMs());
    }

    @Test
    @DisplayName("文件不存在时如实返回 null / false，不抛异常")
    void missingFileReturnsNull() {
        Path missing = Paths.get("target", "definitely-not-here.mp4");
        assertNull(thumbnails.probe(missing));
        assertFalse(thumbnails.extractVideoThumbnail(missing, Paths.get("target", "x.webp")));
    }

    @Test
    @DisplayName("非媒体文件不产生缩略图，也不报错")
    void nonMediaFileYieldsNoThumbnail() throws IOException {
        Path text = Files.createTempFile("not-media-", ".txt");
        try {
            Files.writeString(text, "这不是视频");
            assertFalse(thumbnails.extractVideoThumbnail(text, Paths.get("target", "y.webp")));
        } finally {
            Files.deleteIfExists(text);
        }
    }
}
