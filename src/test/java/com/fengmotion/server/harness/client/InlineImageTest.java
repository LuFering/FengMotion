package com.fengmotion.server.harness.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 内联图片的协议约束。
 *
 * <p>DSH 的 {@code SdkEncodedImageBlock.mimeType} 是字面量联合类型，只接受四种栅格格式。
 * 传别的不会得到「格式不支持」这种可读错误，而是在准入阶段被拒、整条消息失败。
 * 所以这里把边界钉死。</p>
 */
@DisplayName("内联图片")
class InlineImageTest {

    @Test
    @DisplayName("协议接受的四种格式")
    void acceptsFourRasterFormats() {
        assertTrue(DshSdkSession.InlineImage.isSupported("image/png"));
        assertTrue(DshSdkSession.InlineImage.isSupported("image/jpeg"));
        assertTrue(DshSdkSession.InlineImage.isSupported("image/webp"));
        assertTrue(DshSdkSession.InlineImage.isSupported("image/gif"));
    }

    @Test
    @DisplayName("大小写不影响判断")
    void isCaseInsensitive() {
        assertTrue(DshSdkSession.InlineImage.isSupported("IMAGE/PNG"));
    }

    @Test
    @DisplayName("其余类型一律不接受，包括同为 image 的 svg 与 bmp")
    void rejectsEverythingElse() {
        // svg 是矢量、bmp 不在白名单：两者都会让准入失败，必须挡在发送之前
        assertFalse(DshSdkSession.InlineImage.isSupported("image/svg+xml"));
        assertFalse(DshSdkSession.InlineImage.isSupported("image/bmp"));
        assertFalse(DshSdkSession.InlineImage.isSupported("video/mp4"));
        assertFalse(DshSdkSession.InlineImage.isSupported("application/pdf"));
        assertFalse(DshSdkSession.InlineImage.isSupported(null));
        assertFalse(DshSdkSession.InlineImage.isSupported(""));
    }

    @Test
    @DisplayName("图片对象原样保留 base64 与 MIME")
    void carriesPayloadVerbatim() {
        var image = new DshSdkSession.InlineImage("aGVsbG8=", "image/png");

        assertEquals("aGVsbG8=", image.base64());
        assertEquals("image/png", image.mimeType());
    }
}
