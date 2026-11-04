package com.fengmotion.server.asset.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.asset.api.dto.UpdateAssetRequest;
import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.asset.domain.AssetStates;
import com.fengmotion.server.asset.store.AssetRepository;
import com.fengmotion.server.common.ApiException;

/**
 * 素材服务：导入、去重、审核转换、删除拦截。
 *
 * <p>这些断言都对应用户可见的行为，而不是内部实现：重复导入同一个文件不该产生第二条记录；
 * 审核通过不能顺手改授权；被引用的素材删除时要说清「谁在用」。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class AssetServiceTest {

    @Autowired
    private AssetService service;

    @Autowired
    private AssetStorage storage;

    @Autowired
    private AssetRepository repository;

    @Autowired
    private ResourceRefService refs;

    @Autowired
    private AssetFolderService folderService;

    private Asset importText(String name, String content) {
        return service.importFile(name, "text/plain", null, null,
                new ByteArrayInputStream(content.getBytes(StandardCharsets.UTF_8))).asset();
    }

    @Test
    @DisplayName("导入把文件复制进库，并把真实字节数落进索引")
    void importCopiesFileIntoLibrary() throws Exception {
        Asset asset = importText("note.txt", "hello fengmotion");

        assertEquals("note.txt", asset.name());
        assertEquals(AssetStates.MediaType.DOC, asset.mediaType());
        assertEquals("hello fengmotion".length(), asset.sizeBytes(), "字节数应由服务端实测");
        assertEquals(AssetStates.SourceType.IMPORTED, asset.sourceType());
        // 新导入还没解析尺寸/时长，如实停在 pending；审核是「从未提审」而非「待审」。
        assertEquals(AssetStates.ProcessingStatus.PENDING, asset.processingStatus());
        assertEquals(AssetStates.ReviewStatus.NONE, asset.reviewStatus());
        assertEquals(AssetStates.Availability.ENABLED, asset.availability());
        // 没有可靠授权信息，不猜。
        assertEquals(AssetStates.LicenseStatus.UNKNOWN, asset.licenseStatus());

        Path stored = storage.resolve(asset.fileUrl());
        assertTrue(Files.exists(stored), "文件本体应已复制进库");
        assertEquals("hello fengmotion", Files.readString(stored));
    }

    @Test
    @DisplayName("同一内容重复导入不产生第二条记录，但如实返回 deduped")
    void reimportSameContentIsDeduped() {
        AssetService.ImportResult first = service.importFile("a.txt", "text/plain", null, null,
                new ByteArrayInputStream("same".getBytes(StandardCharsets.UTF_8)));
        AssetService.ImportResult second = service.importFile("b.txt", "text/plain", null, "另一个名字",
                new ByteArrayInputStream("same".getBytes(StandardCharsets.UTF_8)));

        assertEquals(first.asset().id(), second.asset().id(), "同一文件本体只应存一份");
        assertFalse(first.deduped());
        assertTrue(second.deduped(), "命中去重时必须如实标记");
        // 去重不合并用户记录：名称仍是第一次导入时的名字，不会被后来者覆盖。
        assertEquals("a.txt", second.asset().name());
    }

    @Test
    @DisplayName("不支持的扩展名被拒绝，且给出 415")
    void unsupportedTypeRejected() {
        ApiException ex = assertThrows(ApiException.class, () -> service.importFile("evil.exe",
                "application/x-msdownload", null, null,
                new ByteArrayInputStream(new byte[] {1, 2, 3})));
        assertEquals("unsupported_media_type", ex.getCode());
        assertEquals(415, ex.getStatus().value());
    }

    @Test
    @DisplayName("审核通过不会改动授权状态")
    void approvingDoesNotTouchLicense() {
        Asset asset = importText("clip.txt", "x");
        // 真实流程：先处理完成 → 提审 → 通过。跳过提审直接通过会被转换表拦下。
        Asset ready = service.update(asset.id(), new UpdateAssetRequest(
                null, null, null, null, null, null, null,
                AssetStates.ProcessingStatus.READY, null, false), asset.etag());
        assertTrue(ready.licenseStatus() == AssetStates.LicenseStatus.UNKNOWN);

        Asset submitted = service.update(ready.id(), new UpdateAssetRequest(
                null, null, null, null, null, AssetStates.ReviewStatus.PENDING, null, null, null, false),
                ready.etag());
        Asset approved = service.update(submitted.id(), new UpdateAssetRequest(
                null, null, null, null, null, AssetStates.ReviewStatus.APPROVED, null, null, null, false),
                submitted.etag());
        assertEquals(AssetStates.ReviewStatus.APPROVED, approved.reviewStatus());
        assertEquals(AssetStates.LicenseStatus.UNKNOWN, approved.licenseStatus(),
                "审核只改审核，绝不推断授权");
    }

    @Test
    @DisplayName("未处理完成的素材不能通过审核")
    void cannotApproveBeforeReady() {
        Asset asset = importText("raw.txt", "x");
        // 先提审，再看「未 ready 就通过」被拦。
        Asset submitted = service.update(asset.id(), new UpdateAssetRequest(
                null, null, null, null, null, AssetStates.ReviewStatus.PENDING, null, null, null, false),
                asset.etag());
        ApiException ex = assertThrows(ApiException.class, () -> service.update(submitted.id(),
                new UpdateAssetRequest(null, null, null, null, null, AssetStates.ReviewStatus.APPROVED,
                        null, null, null, false),
                submitted.etag()));
        assertEquals("review_requires_ready", ex.getCode());
    }

    @Test
    @DisplayName("非法的审核跳转被拒绝，并说明从哪到哪")
    void illegalReviewTransitionRejected() {
        Asset asset = importText("t.txt", "x");
        ApiException ex = assertThrows(ApiException.class, () -> service.update(asset.id(),
                new UpdateAssetRequest(null, null, null, null, null, AssetStates.ReviewStatus.APPROVED,
                        null, null, null, false),
                asset.etag()));
        assertEquals("invalid_review_transition", ex.getCode(), "none 不能直接跳 approved");
        assertTrue(ex.getMessage().contains("none"), "错误消息要说清当前状态");
    }

    @Test
    @DisplayName("被引用的素材不能删除，错误里列出引用方")
    void referencedAssetCannotBeDeleted() {
        Asset asset = importText("used.txt", "x");
        refs.add(ResourceRefService.KIND_ASSET, asset.id(), "project", "proj_1", "演示项目",
                Instant.now().toString());

        ApiException ex = assertThrows(ApiException.class, () -> service.delete(asset.id()));
        assertEquals("asset_in_use", ex.getCode());
        assertEquals(409, ex.getStatus().value());
        assertTrue(repository.findById(asset.id()).isPresent(), "删除失败后素材必须仍然存在");
    }

    @Test
    @DisplayName("未被引用的素材删除后索引与文件一起消失")
    void unreferencedAssetIsDeletedWithFile() {
        /* 内容必须与其它用例不同：多个测试都用 "x" 会命中去重，
           拿到的是同一条记录，而这条测试会把文件删掉 ——
           后面的用例再拿到它时文件已不存在，表现为「导入后文件不见了」。
           这是测试自身的隔离缺陷，不是产品逻辑问题。 */
        Asset asset = importText("gone.txt", "unique-content-for-delete-test");
        Path stored = storage.resolve(asset.fileUrl());
        assertTrue(Files.exists(stored));

        service.delete(asset.id());

        assertTrue(repository.findById(asset.id()).isEmpty());
        assertFalse(Files.exists(stored), "文件本体也应清理，不留孤儿文件");
    }

    @Test
    @DisplayName("批量删除逐项报告，一条失败不影响其他条")
    void batchDeleteReportsPerItem() {
        Asset ok = importText("ok.txt", "ok");
        Asset blocked = importText("blocked.txt", "blocked");
        refs.add(ResourceRefService.KIND_ASSET, blocked.id(), "project", "proj_2", "在用项目",
                Instant.now().toString());

        List<AssetService.DeleteItemResult> results = service.deleteMany(List.of(ok.id(), blocked.id()));

        assertEquals(2, results.size());
        assertTrue(results.stream().anyMatch(r -> r.id().equals(ok.id()) && r.ok()));
        assertTrue(results.stream().anyMatch(r -> r.id().equals(blocked.id()) && !r.ok()));
        assertTrue(repository.findById(ok.id()).isEmpty());
        assertTrue(repository.findById(blocked.id()).isPresent());
    }

    @Test
    @DisplayName("folderId 三态：空串移回根目录，null 表示不改")
    void folderIdTristateMovesToRoot() {
        var folder = folderService.create("三态测试");
        Asset asset = service.importFile("tristate.txt", "text/plain", folder.id(), null,
                new ByteArrayInputStream("x".getBytes(StandardCharsets.UTF_8))).asset();
        assertEquals(folder.id(), asset.folderId());

        // null = 不改：文件夹归属保持。
        Asset unchanged = service.update(asset.id(), new UpdateAssetRequest(
                "改个名", null, null, null, null, null, null, null, null, false), asset.etag());
        assertEquals(folder.id(), unchanged.folderId(), "未提供 folderId 不应移动");

        // 空串 = 移回根目录。
        Asset moved = service.update(unchanged.id(), new UpdateAssetRequest(
                null, null, "", null, null, null, null, null, null, false), unchanged.etag());
        assertEquals(null, moved.folderId(), "空串应把素材移回根目录");
    }

    @Test
    @DisplayName("MIME 缺失或为 octet-stream 时按扩展名判定类型，不误拒真实文件")
    void mediaTypeFallsBackToExtension() {
        // curl / 部分桌面拖拽不带 MIME：不能因为「看不出 MIME」就拒绝一个 mp4。
        assertEquals(AssetStates.MediaType.VIDEO, AssetService.mediaTypeOf("a.mp4", null));
        assertEquals(AssetStates.MediaType.VIDEO, AssetService.mediaTypeOf("a.MOV",
                "application/octet-stream"));
        assertEquals(AssetStates.MediaType.IMAGE, AssetService.mediaTypeOf("p.png", ""));
        assertEquals(AssetStates.MediaType.AUDIO, AssetService.mediaTypeOf("s.mp3", null));
        // MIME 优先：即使扩展名不认识，正确的 MIME 也应被接受。
        assertEquals(AssetStates.MediaType.IMAGE, AssetService.mediaTypeOf("weird", "image/avif"));
        // 两者都认不出才拒绝。
        assertTrue(AssetService.mediaTypeOf("evil.exe", "application/x-msdownload") == null);
    }

    @Test
    @DisplayName("客户端没带 MIME 时按扩展名补具体类型，不把 octet-stream 存进库")
    void mimeFilledFromExtensionWhenMissing() {
        // curl / 部分拖拽不带类型：库里存 octet-stream 会让界面显示无意义的类型。
        assertEquals("video/mp4",
                AssetService.effectiveMimeType("a.mp4", null, AssetStates.MediaType.VIDEO));
        assertEquals("video/mp4", AssetService.effectiveMimeType("a.mp4",
                "application/octet-stream", AssetStates.MediaType.VIDEO));
        assertEquals("image/png",
                AssetService.effectiveMimeType("p.png", "", AssetStates.MediaType.IMAGE));
        // 客户端给了具体类型就原样保留，不擅自改写。
        assertEquals("video/x-custom",
                AssetService.effectiveMimeType("a.mp4", "video/x-custom", AssetStates.MediaType.VIDEO));
    }

    @Test
    @DisplayName("图片不保存时长：ffprobe 报的单帧时长不是语义上的时长")
    void imageHasNoDuration() throws Exception {
        Path png = Paths.get("../desktop/public/editor-sources/token/assets/apps/yuanbao.png");
        org.junit.jupiter.api.Assumptions.assumeTrue(Files.isRegularFile(png), "本机缺少示例图片，跳过");
        Asset asset;
        try (var in = Files.newInputStream(png)) {
            asset = service.importFile("yuanbao.png", "image/png", null, null, in).asset();
        }
        assertEquals(AssetStates.MediaType.IMAGE, asset.mediaType());
        // 宽高要有（用户看得见），时长必须为空（图片没有时长）。
        assertTrue(asset.width() != null && asset.width() > 0, "图片应有宽度");
        assertEquals(null, asset.durationMs(), "图片不应带时长，否则界面会显示 0:00");
    }

    @Test
    @DisplayName("视频导入后带真实宽度和时长，并生成缩略图")
    void videoGetsMetadataAndThumbnail() throws Exception {
        Path mp4 = Paths.get("../desktop/public/fx/motion/fx-dolly-zoom.mp4");
        org.junit.jupiter.api.Assumptions.assumeTrue(Files.isRegularFile(mp4), "本机缺少示例视频，跳过");
        Asset asset;
        try (var in = Files.newInputStream(mp4)) {
            asset = service.importFile("fx-dolly-zoom.mp4", "video/mp4", null, null, in).asset();
        }
        assertEquals(640, asset.width());
        assertEquals(360, asset.height());
        assertEquals(10_000L, asset.durationMs());
        assertTrue(asset.thumbnailUrl() != null, "视频应生成缩略图");
        assertEquals(AssetStates.ProcessingStatus.READY, asset.processingStatus(),
                "解析成功后才标 ready");
    }

    @Test
    @DisplayName("素材路径不能越出存储根")
    void storageRejectsPathTraversal() {
        assertFalse(storage.isInsideRoot("../../etc/passwd"));
        assertTrue(storage.isInsideRoot("assets/ab/abc/original.txt"));
        assertThrows(IllegalArgumentException.class, () -> storage.resolve("../../etc/passwd"));
    }
}
