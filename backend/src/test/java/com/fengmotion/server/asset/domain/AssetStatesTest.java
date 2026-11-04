package com.fengmotion.server.asset.domain;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.fengmotion.server.asset.domain.AssetStates.ReviewStatus;

/**
 * 审核状态转换表。
 *
 * <p>要挡住的不是「少一个转换」，而是三类会静默掩盖问题的做法：
 * <ol>
 *   <li>把 {@code needs_review}（审了、要求改）压成 {@code pending}（还没审）—— 用户分不清谁看过；</li>
 *   <li>从 {@code none} 直接跳到 {@code approved} —— 等于没有审核记录却显示「已通过」；</li>
 *   <li>把 {@code rejected}（终局否定）当成可随手回退的中间态。</li>
 * </ol>
 */
class AssetStatesTest {

    @Test
    @DisplayName("新导入素材从 none 只能进入 pending，不能直接通过")
    void noneCannotJumpToApproved() {
        assertTrue(ReviewStatus.NONE.canTransitionTo(ReviewStatus.PENDING));
        assertFalse(ReviewStatus.NONE.canTransitionTo(ReviewStatus.APPROVED),
                "跳过提审直接通过，等于没有审核记录");
        assertFalse(ReviewStatus.NONE.canTransitionTo(ReviewStatus.NEEDS_REVIEW));
    }

    @Test
    @DisplayName("needs_review 是「审了要改」，与 pending「还没审」语义相反")
    void needsReviewIsNotPending() {
        assertTrue(ReviewStatus.PENDING.canTransitionTo(ReviewStatus.NEEDS_REVIEW));
        assertTrue(ReviewStatus.NEEDS_REVIEW.canTransitionTo(ReviewStatus.PENDING));
        assertFalse(ReviewStatus.NEEDS_REVIEW.canTransitionTo(ReviewStatus.APPROVED),
                "要求修改后必须先重新提审，不能直接通过");
    }

    @Test
    @DisplayName("approved 发现问题时可以回溯为 needs_review，rejected 可以重提")
    void approvedCanRegressAndRejectedCanBeResubmitted() {
        assertTrue(ReviewStatus.APPROVED.canTransitionTo(ReviewStatus.NEEDS_REVIEW));
        assertTrue(ReviewStatus.REJECTED.canTransitionTo(ReviewStatus.PENDING));
        assertFalse(ReviewStatus.REJECTED.canTransitionTo(ReviewStatus.APPROVED));
    }

    @Test
    @DisplayName("相同状态转换视为幂等，重复提交同一状态不算冲突")
    void sameStateIsIdempotent() {
        for (ReviewStatus status : ReviewStatus.values()) {
            assertTrue(status.canTransitionTo(status), status + " 自身转换应幂等");
        }
    }

    @Test
    @DisplayName("停用与弃用的素材不接受新增引用，启用的接受")
    void onlyEnabledAcceptsNewRefs() {
        assertTrue(AssetStates.Availability.ENABLED.acceptsNewRefs());
        assertFalse(AssetStates.Availability.DISABLED.acceptsNewRefs());
        assertFalse(AssetStates.Availability.DEPRECATED.acceptsNewRefs());
    }

    @Test
    @DisplayName("wire 取值与契约一致，非法取值抛 400")
    void wireValuesMatchContract() {
        assertTrue(ReviewStatus.NEEDS_REVIEW.wire().equals("needs_review"));
        assertTrue(ReviewStatus.NONE.wire().equals("none"));
        assertTrue(ReviewStatus.fromWire("needs_review") == ReviewStatus.NEEDS_REVIEW);
        assertTrue(ReviewStatus.fromWire(null) == null, "未提供应返回 null 而不是默认值");

        var ex = org.junit.jupiter.api.Assertions.assertThrows(
                com.fengmotion.server.common.ApiException.class,
                () -> ReviewStatus.fromWire("ready"));
        assertTrue(ex.getCode().equals("validation_error"));
    }
}
