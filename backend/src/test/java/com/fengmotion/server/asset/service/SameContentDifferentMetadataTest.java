package com.fengmotion.server.asset.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.asset.domain.Asset;
import com.fengmotion.server.asset.domain.AssetStates;
import com.fengmotion.server.asset.store.AssetQuery;
import com.fengmotion.server.asset.store.AssetRepository;

/**
 * 同一文件内容、不同用户记录。
 *
 * <p>用户明确要求：**文件本体可以去重，但不同名称/标签/授权/文件夹的素材记录不被合并**。</p>
 *
 * <p>原实现只要内容哈希命中就直接返回已有记录，第二条的名称与标签永久丢失，
 * 而迁移仍报「完成」。这个测试用两条内容相同、元数据不同的记录验证修复。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class SameContentDifferentMetadataTest {

    @Autowired
    private AssetService service;

    @Autowired
    private AssetRepository repository;

    /** 用来把 fileUrl 解析成磁盘路径，验证文件本体真的还在。 */
    @Autowired
    private AssetStorage storage;

    private static ByteArrayInputStream sameContent() {
        return new ByteArrayInputStream("identical file body".getBytes(StandardCharsets.UTF_8));
    }

    @Test
    @DisplayName("默认导入仍去重：重复拖同一文件不产生第二条")
    void defaultImportStillDedupes() {
        var first = service.importFile("a.txt", "text/plain", null, "第一个名字", sameContent(), false);
        var second = service.importFile("b.txt", "text/plain", null, "第二个名字", sameContent(), false);

        assertFalse(first.deduped(), "第一条是新建");
        assertTrue(second.deduped(), "第二条应命中去重");
        assertEquals(first.asset().id(), second.asset().id(), "默认行为仍是同一条记录");
    }

    @Test
    @DisplayName("迁移模式保留独立记录：文件共用，名称与标签各自存在")
    void keepSeparateRecordPreservesMetadata() {
        // 旧库里的两条记录：内容相同，名称与标签不同
        Asset first = service.importFile("same.txt", "text/plain", null, "旧素材甲", sameContent(), true)
                .asset();
        Asset second = service.importFile("same.txt", "text/plain", null, "旧素材乙", sameContent(), true)
                .asset();

        // 必须是两条独立记录
        assertNotEquals(first.id(), second.id(), "内容相同但要求独立记录时，id 必须不同");
        assertEquals("旧素材甲", first.name());
        assertEquals("旧素材乙", second.name(), "第二条的名称不能被第一条覆盖");

        // 文件本体共用：指向同一份存储路径，不占第二份磁盘
        assertEquals(first.fileUrl(), second.fileUrl(), "文件本体应复用同一份");
        assertEquals(first.sizeBytes(), second.sizeBytes());
    }

    @Test
    @DisplayName("两条独立记录可分别改标签、授权、文件夹而互不影响")
    void separateRecordsHaveIndependentMetadata() {
        Asset a = service.importFile("x.txt", "text/plain", null, "甲", sameContent(), true).asset();
        Asset b = service.importFile("x.txt", "text/plain", null, "乙", sameContent(), true).asset();

        // 给甲打标签并改授权
        service.update(a.id(), new com.fengmotion.server.asset.api.dto.UpdateAssetRequest(
                null, List.of("标签甲"), null, AssetStates.LicenseStatus.ALLOWED, "可商用",
                null, null, null, null, false), a.etag());

        Asset reloadedA = service.require(a.id());
        Asset reloadedB = service.require(b.id());

        assertEquals(List.of("标签甲"), reloadedA.tags());
        assertTrue(reloadedB.tags().isEmpty(), "乙的标签不该被甲的改动影响");
        assertEquals(AssetStates.LicenseStatus.ALLOWED, reloadedA.licenseStatus());
        assertEquals(AssetStates.LicenseStatus.UNKNOWN, reloadedB.licenseStatus(),
                "乙的授权应独立保持 unknown");
    }

    @Test
    @DisplayName("独立记录保留真实哈希，第三方再导同一文件仍能复用文件本体")
    void separateRecordKeepsRealHash() {
        Asset a = service.importFile("h.txt", "text/plain", null, "哈希甲", sameContent(), true).asset();
        Asset b = service.importFile("h.txt", "text/plain", null, "哈希乙", sameContent(), true).asset();

        // 两条记录都应该带同一个真实哈希（不带后缀 hack）
        assertEquals(a.contentHash(), b.contentHash(), "同内容记录应记同一个哈希");
        assertFalse(a.contentHash().contains("#"), "哈希不应被改写");

        // 第三方（不带 keepSeparateRecord）再导同一文件，应命中去重并复用已有文件
        var third = service.importFile("z.txt", "text/plain", null, "第三方", sameContent(), false);
        assertTrue(third.deduped(), "同内容再导入应当命中已有文件");
        assertEquals(a.fileUrl(), third.asset().fileUrl(), "复用同一份文件本体");
    }

    @Test
    @DisplayName("两条记录都能被列出，不会因为内容相同而少一条")
    void bothRecordsAreListed() {
        service.importFile("y.txt", "text/plain", null, "记录一", sameContent(), true);
        service.importFile("y.txt", "text/plain", null, "记录二", sameContent(), true);

        List<Asset> all = repository.search(new AssetQuery(null, null, null, null, null, null,
                null, false, null, null, "name", 100, 0));
        List<String> names = all.stream().map(Asset::name).filter(n -> n.startsWith("记录")).toList();
        assertEquals(2, names.size(), "同内容的两条用户记录都必须出现在列表里");
    }

    @Test
    @DisplayName("删除其中一条记录时，另一条的文件本体必须仍然存在")
    void deletingOneRecordKeepsSharedFile() throws Exception {
        Asset a = service.importFile("s.txt", "text/plain", null, "先删的", sameContent(), true).asset();
        Asset b = service.importFile("s.txt", "text/plain", null, "留下的", sameContent(), true).asset();
        assertEquals(a.fileUrl(), b.fileUrl(), "前提：两条记录共用同一份文件");

        service.delete(a.id());

        assertTrue(repository.findById(a.id()).isEmpty(), "被删的记录应消失");
        assertTrue(repository.findById(b.id()).isPresent(), "另一条记录必须还在");
        /* 只查数据库记录不够：记录在但文件被删，用户点开是 404。
           这里直接验证磁盘上的文件仍然可读。 */
        java.nio.file.Path shared = storage.resolve(b.fileUrl());
        assertTrue(java.nio.file.Files.exists(shared), "共用文件被误删，留下的记录会打不开");
    }

    @Test
    @DisplayName("库里记录还在但文件被外部删掉时，再次导入应重新落盘而不是返回死记录")
    void reimportRepairsMissingFile() throws Exception {
        Asset first = service.importFile("lost.txt", "text/plain", null, "丢失的", sameContent(), true).asset();
        java.nio.file.Path stored = storage.resolve(first.fileUrl());

        // 模拟外部清理：目录还在，文件没了（实测中出现过的状态）
        java.nio.file.Files.delete(stored);
        assertFalse(java.nio.file.Files.exists(stored), "前提：文件已不在");

        var again = service.importFile("lost.txt", "text/plain", null, "再导入", sameContent(), false);

        assertTrue(java.nio.file.Files.exists(stored), "再次导入后文件必须重新落盘");
        assertTrue(java.nio.file.Files.size(stored) > 0, "重新落盘的文件不能是空壳");
        assertEquals(first.fileUrl(), again.asset().fileUrl(), "仍是同一条记录、同一份路径");
    }

    @Test
    @DisplayName("删除最后一条共用记录时，文件本体应被清理")
    void deletingLastRecordRemovesFile() throws Exception {
        Asset a = service.importFile("t.txt", "text/plain", null, "甲", sameContent(), true).asset();
        Asset b = service.importFile("t.txt", "text/plain", null, "乙", sameContent(), true).asset();
        java.nio.file.Path shared = storage.resolve(b.fileUrl());

        service.delete(a.id());
        assertTrue(java.nio.file.Files.exists(shared), "还有共用者时不该删文件");

        service.delete(b.id());
        assertFalse(java.nio.file.Files.exists(shared), "最后一个使用者删除后应清理文件，不留孤儿目录");
    }
}
