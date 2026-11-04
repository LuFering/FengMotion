package com.fengmotion.server.fx.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.fx.domain.FxStates;
import com.fengmotion.server.fx.domain.FxTechnique;
import com.fengmotion.server.fx.store.FxTechniqueRepository.FxQuery;

/**
 * 特效库导入与检索。
 *
 * <p>最要紧的一条断言是「{@code execType=runnable} 不等于本机可执行」。
 * 源库标了 9 条 runnable，但 FengMotion 还没有对应执行器 ——
 * 如果界面按 execType 显示「可执行」，用户点下去会发现什么都没有。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class FxTechniqueServiceTest {

    @Autowired
    private FxCatalogImporter importer;

    @Autowired
    private FxTechniqueService service;

    private FxQuery all() {
        return new FxQuery(null, null, null, null, null, false, false, null, "cat", 100, 0);
    }

    @Test
    @DisplayName("内置目录导入 16 条，字段与源库一致")
    void importsBuiltinCatalog() {
        importer.importBuiltin(false);
        assertEquals(16, service.total());

        FxTechnique dolly = service.require("fx-dolly-zoom");
        assertEquals("多莉变焦", dolly.name());
        assertEquals("Dolly Zoom", dolly.nameEn());
        assertEquals(FxStates.Category.CAMERA, dolly.category());
        assertEquals(FxStates.Impl.AI, dolly.impl());
        assertEquals(3, dolly.complexity());
        // 源库的 execType 必须原样保留，不能因为「我们跑不了」就改成 reference。
        assertEquals(FxStates.ExecType.RUNNABLE, dolly.execType());
        assertTrue(dolly.aliases().contains("眩晕镜头"));
        assertTrue(dolly.keywords().contains("希区柯克"));
        assertEquals(3, dolly.params().size());
        assertEquals("70%", dolly.params().get(2).value());
        assertTrue(dolly.steps().size() >= 3);
        assertTrue(dolly.limitations().size() >= 1);
    }

    @Test
    @DisplayName("execType=runnable 不代表本机可执行：全部默认 not-implemented")
    void declaredCapabilityIsNotExecution() {
        importer.importBuiltin(false);
        List<FxTechnique> all = service.search(all());
        long declaredRunnable = all.stream()
                .filter(t -> t.execType() == FxStates.ExecType.RUNNABLE)
                .count();
        assertTrue(declaredRunnable > 0, "源库里应存在 runnable 的技法");

        // 关键断言：即使源库说 runnable，本机也没有一个真的能跑。
        for (FxTechnique t : all) {
            assertEquals(FxStates.ExecutionStatus.NOT_IMPLEMENTED, t.executionStatus(),
                    t.id() + " 的源库标签是 " + t.execType().wire()
                            + "，但本机没有执行器，不能标成可执行");
            assertFalse(service.executableNow(t.id()), t.id() + " 不该被判为可执行");
        }
    }

    @Test
    @DisplayName("重复导入幂等，条数不翻倍")
    void importIsIdempotent() {
        importer.importBuiltin(false);
        int first = service.total();
        importer.importBuiltin(false);
        assertEquals(first, service.total());
    }

    @Test
    @DisplayName("中文子串能搜别名与检索词，不只是名称")
    void searchMatchesAliasesAndKeywords() {
        importer.importBuiltin(false);
        // 「眩晕」只出现在 fx-dolly-zoom 的 aliases 与 keywords 里，name 是「多莉变焦」。
        List<FxTechnique> hits = service.search(new FxQuery(null, null, null, null, null, false, false,
                "眩晕", "cat", 50, 0));
        assertTrue(hits.stream().anyMatch(t -> t.id().equals("fx-dolly-zoom")),
                "搜别名应能命中多莉变焦");
    }

    @Test
    @DisplayName("搜不到时返回空列表而不是报错")
    void searchMissReturnsEmpty() {
        importer.importBuiltin(false);
        List<FxTechnique> hits = service.search(new FxQuery(null, null, null, null, null, false, false,
                "绝对不存在的词xyz", "cat", 50, 0));
        assertTrue(hits.isEmpty());
    }

    @Test
    @DisplayName("按分类筛选：运镜 3 条")
    void filterByCategory() {
        importer.importBuiltin(false);
        List<FxTechnique> camera = service.search(new FxQuery(FxStates.Category.CAMERA, null, null, null,
                null, false, false, null, "cat", 50, 0));
        assertEquals(3, camera.size());
        assertTrue(camera.stream().allMatch(t -> t.category() == FxStates.Category.CAMERA));
    }

    @Test
    @DisplayName("收藏与最近浏览互相独立，且不写进技法目录")
    void favoriteAndViewAreIndependent() {
        importer.importBuiltin(false);
        String id = "fx-dolly-zoom";

        // 收藏不影响最近浏览时间。
        var afterFavorite = service.updateState(id, true, false);
        assertTrue(afterFavorite.favorited());
        assertEquals(null, afterFavorite.lastViewedAt(), "收藏不该顺手记一次浏览");

        // 浏览不影响收藏。
        var afterView = service.updateState(id, null, true);
        assertTrue(afterView.favorited(), "浏览不该取消收藏");
        assertNotNull(afterView.lastViewedAt());

        // 取消收藏后，收藏时间仍在（那是浏览记录，不是收藏记录）。
        var afterUnfavorite = service.updateState(id, false, false);
        assertFalse(afterUnfavorite.favorited());
        assertNotNull(afterUnfavorite.lastViewedAt());
    }

    @Test
    @DisplayName("筛选面计数不受筛选影响，且补齐未出现的分类为 0")
    void facetsAreGlobal() {
        importer.importBuiltin(false);
        var facets = service.facets();
        var categories = facets.get("categories");
        // 七个分类全部出现（即使某分类为 0），否则筛选面板会缺选项。
        assertEquals(7, categories.size());
        assertEquals(3, categories.get("camera"));
        assertEquals(2, categories.get("transition"));
        assertEquals(16, service.total());
    }

    @Test
    @DisplayName("只看收藏时只返回收藏的技法")
    void filterFavoritedOnly() {
        importer.importBuiltin(false);
        service.updateState("fx-dolly-zoom", true, false);
        List<FxTechnique> favs = service.search(new FxQuery(null, null, null, null, null, false, true,
                null, "cat", 50, 0));
        assertEquals(1, favs.size());
        assertEquals("fx-dolly-zoom", favs.get(0).id());
    }
}
