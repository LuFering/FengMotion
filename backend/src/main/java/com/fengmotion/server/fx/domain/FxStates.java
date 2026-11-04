package com.fengmotion.server.fx.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

import org.springframework.http.HttpStatus;

import com.fengmotion.server.common.ApiException;

/**
 * 特效库的取值枚举（契约 library.md §2）。
 *
 * <p><strong>本类最重要的区分</strong>：{@link ExecType} 是**源库声明的能力标签**，
 * {@link ExecutionStatus} 才是**这台机器现在能不能跑**。把两者混成一个字段，
 * 就会出现「界面说可直接执行，点下去什么都没有」——这是用户最容易被骗的地方。</p>
 */
public final class FxStates {

    private FxStates() {
    }

    /** 按效果**用途**分类，不按实现技术（契约 §2.1）。 */
    public enum Category {
        CAMERA("camera", "运镜"),
        TRANSITION("transition", "转场"),
        LIGHTING("lighting", "光影"),
        PARTICLES("particles", "粒子"),
        COMPOSITING("compositing", "合成"),
        STYLIZE("stylize", "风格化"),
        TYPOGRAPHY("typography", "文字动画");

        private final String wire;
        private final String label;

        Category(String wire, String label) {
            this.wire = wire;
            this.label = label;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        public String label() {
            return label;
        }

        @JsonCreator
        public static Category fromWire(String value) {
            if (value == null) return null;
            for (Category c : values()) {
                if (c.wire.equals(value)) return c;
            }
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "category 取值无效：" + value);
        }
    }

    /**
     * 源库声明的执行类型。
     *
     * <p><strong>这只是标签</strong>。{@code runnable} 表示「源库认为它可以被程序执行」，
     * 不表示 FengMotion 已经有对应的执行器。</p>
     */
    public enum ExecType {
        RUNNABLE("runnable", "可直接执行"),
        COMPOSABLE("composable", "可组合"),
        REFERENCE("reference", "仅参考");

        private final String wire;
        private final String label;

        ExecType(String wire, String label) {
            this.wire = wire;
            this.label = label;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        public String label() {
            return label;
        }

        @JsonCreator
        public static ExecType fromWire(String value) {
            if (value == null) return null;
            for (ExecType c : values()) {
                if (c.wire.equals(value)) return c;
            }
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "execType 取值无效：" + value);
        }
    }

    /**
     * 本机真实可执行状态。
     *
     * <p>默认 {@code NOT_IMPLEMENTED}。只有适配器与依赖都真实存在才能标 {@code AVAILABLE} ——
     * 判据是「真的能跑通」，不是「契约里有这个字段」。</p>
     */
    public enum ExecutionStatus {
        /** 源库声明了能力，但本机没有接线。 */
        DECLARED("declared"),
        /** 明确知道没有实现（默认值）。 */
        NOT_IMPLEMENTED("not-implemented"),
        /** 适配器与依赖都存在，真的能执行。 */
        AVAILABLE("available");

        private final String wire;

        ExecutionStatus(String wire) {
            this.wire = wire;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        @JsonCreator
        public static ExecutionStatus fromWire(String value) {
            if (value == null) return null;
            for (ExecutionStatus c : values()) {
                if (c.wire.equals(value)) return c;
            }
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "executionStatus 取值无效：" + value);
        }

        /** 界面能不能显示「可执行」。只有真的可用才算。 */
        public boolean executableNow() {
            return this == AVAILABLE;
        }
    }

    /** 实现方式。 */
    public enum Impl {
        REALTIME("realtime", "实时"),
        OFFLINE("offline", "离线"),
        AI("ai", "AI 生成"),
        COMPOSITE("composite", "合成");

        private final String wire;
        private final String label;

        Impl(String wire, String label) {
            this.wire = wire;
            this.label = label;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        public String label() {
            return label;
        }

        @JsonCreator
        public static Impl fromWire(String value) {
            if (value == null) return null;
            for (Impl c : values()) {
                if (c.wire.equals(value)) return c;
            }
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "impl 取值无效：" + value);
        }
    }

    /** 需要的输入类型。 */
    public enum InputKind {
        IMAGE("image", "图像"),
        VIDEO("video", "视频"),
        AUDIO("audio", "音频"),
        TEXT("text", "文本");

        private final String wire;
        private final String label;

        InputKind(String wire, String label) {
            this.wire = wire;
            this.label = label;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        public String label() {
            return label;
        }

        @JsonCreator
        public static InputKind fromWire(String value) {
            if (value == null) return null;
            for (InputKind c : values()) {
                if (c.wire.equals(value)) return c;
            }
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "inputKind 取值无效：" + value);
        }
    }

}
