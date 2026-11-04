package com.fengmotion.server.asset.service;

import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.asset.domain.AssetStates;

/** ffmpeg 不可用时：导入仍要成功，只是没有缩略图与元数据。 */
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = {
    "fengmotion.asset.ffmpeg=/nonexistent/ffmpeg",
    "fengmotion.asset.ffprobe=/nonexistent/ffprobe",
})
class NoFfmpegFallbackTest {

    @Autowired
    private AssetService service;

    @Test
    @DisplayName("没有 ffmpeg 时导入照常成功，缩略图为空且状态停在 pending")
    void importSucceedsWithoutFfmpeg() throws Exception {
        Asset asset = service.importFile("plain.txt", "text/plain", null, null,
                new ByteArrayInputStream("x".getBytes(StandardCharsets.UTF_8))).asset();
        assertEquals(AssetStates.MediaType.DOC, asset.mediaType());
        assertNull(asset.thumbnailUrl(), "没有 ffmpeg 就不该有缩略图");
        assertEquals(AssetStates.ProcessingStatus.PENDING, asset.processingStatus(),
                "什么都没解析出来时不该声称 ready");
    }
}
