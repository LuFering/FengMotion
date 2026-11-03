package com.fengmotion.server.upload.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;

import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.upload.domain.UploadedFile;

/**
 * 附件上传的落盘与边界。
 *
 * <p>重点不在「能存下来」，而在几条安全边界：
 * 文件名不能用来拼路径、未知类型要拒绝、超限要拒绝、路径不能越出根目录。</p>
 */
@DisplayName("附件上传")
class UploadServiceTest {

    @TempDir
    Path tempDir;

    /**
     * 构造一个落盘到临时目录的服务。
     *
     * @return 服务实例
     */
    private UploadService service() {
        return new UploadService(tempDir.toString());
    }

    @Test
    @DisplayName("保存后产物在根目录下，且文件名不含用户提供的名字")
    void storesUnderRootWithGeneratedName() throws Exception {
        UploadService uploads = service();
        var file = new MockMultipartFile("file", "我的截图.png", "image/png", new byte[] {1, 2, 3});

        UploadedFile stored = uploads.store(file);

        assertEquals("我的截图.png", stored.name(), "展示名保留原名");
        assertEquals("image", stored.kind());
        assertEquals(3, stored.sizeBytes());
        assertFalse(stored.sha256().isBlank(), "必须算出内容摘要");

        // 落盘名是 UUID，不是原始文件名
        Path onDisk = tempDir.resolve(stored.id() + ".png");
        assertTrue(Files.exists(onDisk), "文件应落在根目录下");
    }

    @Test
    @DisplayName("带路径的文件名不会把文件写到根目录之外")
    void stripsPathFromClientFilename() throws Exception {
        UploadService uploads = service();
        // 浏览器与恶意客户端都可能回传带路径的文件名
        var file = new MockMultipartFile("file", "../../etc/passwd.txt", "text/plain", new byte[] {1});

        UploadedFile stored = uploads.store(file);

        assertEquals("passwd.txt", stored.name(), "只保留最后一段作为展示名");
        // 真正落盘的文件必须仍在 tempDir 内
        try (var paths = Files.list(tempDir)) {
            assertEquals(1, paths.count(), "根目录下只应有一个产物");
        }
    }

    @Test
    @DisplayName("空文件被拒绝")
    void rejectsEmptyFile() {
        UploadService uploads = service();
        var empty = new MockMultipartFile("file", "a.png", "image/png", new byte[0]);

        assertThrows(ApiException.class, () -> uploads.store(empty));
    }

    @Test
    @DisplayName("不在白名单的 MIME 被拒绝")
    void rejectsDisallowedMime() {
        UploadService uploads = service();
        // 可执行文件不该被当作附件收下
        var binary = new MockMultipartFile("file", "run.exe", "application/x-msdownload", new byte[] {1});

        assertThrows(ApiException.class, () -> uploads.store(binary));
    }

    @Test
    @DisplayName("超过大小上限被拒绝")
    void rejectsOversizedFile() {
        UploadService uploads = service();
        byte[] tooBig = new byte[64 * 1024 * 1024 + 1];
        var file = new MockMultipartFile("file", "big.mp4", "video/mp4", tooBig);

        assertThrows(ApiException.class, () -> uploads.store(file));
    }

    @Test
    @DisplayName("按 MIME 归类，未知类型归 file")
    void classifiesByMime() {
        UploadService uploads = service();

        assertEquals("video", uploads.store(
                new MockMultipartFile("file", "a.mp4", "video/mp4", new byte[] {1})).kind());
        assertEquals("audio", uploads.store(
                new MockMultipartFile("file", "a.mp3", "audio/mpeg", new byte[] {1})).kind());
        assertEquals("file", uploads.store(
                new MockMultipartFile("file", "a.pdf", "application/pdf", new byte[] {1})).kind());
    }

    @Test
    @DisplayName("MIME 带参数时仍能识别，并去掉参数")
    void normalizesMimeWithParameters() {
        UploadService uploads = service();
        var file = new MockMultipartFile("file", "a.png", "image/png; charset=binary", new byte[] {1});

        UploadedFile stored = uploads.store(file);

        assertEquals("image/png", stored.mimeType());
        assertEquals("image", stored.kind());
    }

    @Test
    @DisplayName("resolve 能找回带扩展名的落盘文件")
    void resolvesFileWithExtension() {
        UploadService uploads = service();
        UploadedFile stored = uploads.store(
                new MockMultipartFile("file", "a.png", "image/png", new byte[] {1, 2, 3}));

        // 落盘名是 id + 扩展名；resolve 必须能按 id 找回它，否则读附件内容会静默失败
        java.nio.file.Path resolved = uploads.resolve(stored.id());
        assertTrue(Files.isRegularFile(resolved), "应按 id 找回带扩展名的文件: " + resolved);
    }

    @Test
    @DisplayName("asInlineImage 对支持的格式产出 base64，对不支持的返回 null")
    void asInlineImageConvertsSupportedFormats() {
        UploadService uploads = service();
        UploadedFile png = uploads.store(
                new MockMultipartFile("file", "a.png", "image/png", new byte[] {9, 8, 7}));

        var image = uploads.asInlineImage(png.id(), "image/png");
        assertTrue(image != null, "png 应能转成内联图片");
        // base64 of {9,8,7} = "CQgH"
        assertEquals("CQgH", image.base64());
        assertEquals("image/png", image.mimeType());

        // svg 不在协议白名单内，必须返回 null 而不是构造一个会被准入拒绝的块
        UploadedFile pdf = uploads.store(
                new MockMultipartFile("file", "a.pdf", "application/pdf", new byte[] {1}));
        assertEquals(null, uploads.asInlineImage(pdf.id(), "application/pdf"));
    }

    @Test
    @DisplayName("读取路径时拒绝非法标识，防止目录穿越")
    void rejectsIllegalIdInResolve() {
        UploadService uploads = service();

        assertThrows(ApiException.class, () -> uploads.resolve("../../etc/passwd"));
        assertThrows(ApiException.class, () -> uploads.resolve(null));
        assertThrows(ApiException.class, () -> uploads.resolve(""));
    }
}
