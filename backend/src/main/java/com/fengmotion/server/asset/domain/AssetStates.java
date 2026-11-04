package com.fengmotion.server.asset.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * 素材的五个正交状态维度 + 演示标记（契约 asset.md §1）。
 *
 * <p>为什么集中在这里，而不是散在各处写字符串：迁移时最容易发生的事故是
 * 「把 pending 和 needs_review 压成同一个 ready」，或者「审核通过就顺手把授权也标成可用」。
 * 把取值与合法转换写在一处，才能在编译期和测试里同时挡住这两类错误。</p>
 */
public final class AssetStates {

    private AssetStates() {
    }

    /** 文件从哪来。与「是否演示」正交：内置真实文件也可以是演示用途。 */
    public enum SourceType {
        BUILTIN("builtin"),
        IMPORTED("imported"),
        GENERATED("generated"),
        /** 内容本身是编造/占位的条目。不要因为文件真实存在就用这个值。 */
        SAMPLE("sample");

        private final String wire;

        SourceType(String wire) {
            this.wire = wire;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        @JsonCreator
        public static SourceType fromWire(String value) {
            return Enums.parse(SourceType.class, SourceType::wire, value, "sourceType");
        }
    }

    /** 处理到哪一步（解析 / 转码 / 抽帧等）。 */
    public enum ProcessingStatus {
        PENDING("pending"),
        PROCESSING("processing"),
        READY("ready"),
        FAILED("failed");

        private final String wire;

        ProcessingStatus(String wire) {
            this.wire = wire;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        @JsonCreator
        public static ProcessingStatus fromWire(String value) {
            return Enums.parse(ProcessingStatus.class, ProcessingStatus::wire, value, "processingStatus");
        }
    }

    /**
     * 人确认过吗（契约 asset.md §1.1）。
     *
     * <p>{@code PENDING} 是「还没审」，{@code NEEDS_REVIEW} 是「审了、要求改」——
     * 二者语义相反，迁移时压平会让用户分不清「没人看过」和「看过了要改」。</p>
     */
    public enum ReviewStatus {
        /** 从未提审。新导入素材的初始值。 */
        NONE("none"),
        /** 已提审，未出结论。 */
        PENDING("pending"),
        /** 审过，结论是「需要修改后再提」。 */
        NEEDS_REVIEW("needs_review"),
        /** 审核通过。 */
        APPROVED("approved"),
        /** 终局否定，不再采用。 */
        REJECTED("rejected");

        private final String wire;

        ReviewStatus(String wire) {
            this.wire = wire;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        @JsonCreator
        public static ReviewStatus fromWire(String value) {
            return Enums.parse(ReviewStatus.class, ReviewStatus::wire, value, "reviewStatus");
        }

        /**
         * 该状态能否转到 {@code next}。
         *
         * <p>转换表见契约 asset.md §1.1。{@code NONE} 不能直接跳到 {@code APPROVED}：
         * 跳过提审直接通过，等于没有审核记录。</p>
         */
        public boolean canTransitionTo(ReviewStatus next) {
            if (this == next) {
                return true;
            }
            return switch (this) {
                case NONE -> next == PENDING;
                case PENDING -> next == APPROVED || next == REJECTED || next == NEEDS_REVIEW;
                case NEEDS_REVIEW -> next == PENDING || next == REJECTED;
                case APPROVED -> next == NEEDS_REVIEW;
                case REJECTED -> next == PENDING;
            };
        }
    }

    /** 现在还能用吗。{@code DEPRECATED} 是终态。 */
    public enum Availability {
        ENABLED("enabled"),
        DISABLED("disabled"),
        DEPRECATED("deprecated");

        private final String wire;

        Availability(String wire) {
            this.wire = wire;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        @JsonCreator
        public static Availability fromWire(String value) {
            return Enums.parse(Availability.class, Availability::wire, value, "availability");
        }

        /** 停用/弃用的资源禁止新增引用，已有引用保留。 */
        public boolean acceptsNewRefs() {
            return this == ENABLED;
        }
    }

    /**
     * 授权状态。**与审核完全独立**：审核通过不代表有使用许可。
     *
     * <p>无可靠信息一律 {@code UNKNOWN}，不要因为「看起来是自家素材」就猜成 ALLOWED。</p>
     */
    public enum LicenseStatus {
        ALLOWED("allowed"),
        ATTRIBUTION_REQUIRED("attribution_required"),
        RESTRICTED("restricted"),
        UNKNOWN("unknown");

        private final String wire;

        LicenseStatus(String wire) {
            this.wire = wire;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        @JsonCreator
        public static LicenseStatus fromWire(String value) {
            return Enums.parse(LicenseStatus.class, LicenseStatus::wire, value, "licenseStatus");
        }
    }

    /** 媒体类型。 */
    public enum MediaType {
        IMAGE("image"),
        VIDEO("video"),
        AUDIO("audio"),
        FONT("font"),
        DOC("doc");

        private final String wire;

        MediaType(String wire) {
            this.wire = wire;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        @JsonCreator
        public static MediaType fromWire(String value) {
            return Enums.parse(MediaType.class, MediaType::wire, value, "mediaType");
        }
    }
}
