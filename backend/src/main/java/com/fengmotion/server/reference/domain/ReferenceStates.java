package com.fengmotion.server.reference.domain;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

import org.springframework.http.HttpStatus;

import com.fengmotion.server.common.ApiException;

/**
 * 参考片的取值枚举与六维分析定义（契约 library.md §4）。
 *
 * <p>为什么把分析维度写死在代码里而不是自由 map：维度是**产品约定**
 * （「用户要回答的是这条片段能不能拿来创作」），不是数据。写死之后，
 * 少一维或多一维都会在编译期/测试里暴露，而不是等到界面显示时才被发现。</p>
 */
public final class ReferenceStates {

    private ReferenceStates() {
    }

    /** 解析状态。{@code pending} 表示还没解析，不是「解析了但没内容」。 */
    public enum Status {
        ANALYZED("analyzed"),
        PARTIAL("partial"),
        PENDING("pending");

        private final String wire;

        Status(String wire) {
            this.wire = wire;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        @JsonCreator
        public static Status fromWire(String value) {
            if (value == null) {
                return null;
            }
            for (Status s : values()) {
                if (s.wire.equals(value)) {
                    return s;
                }
            }
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "status 取值无效：" + value);
        }
    }

    /**
     * 分析值的来源。
     *
     * <p>界面上必须能区分：把模型判断显示成实测事实，是这类工具最容易犯的错。
     * 三分而不是两分，是因为「用户自己填的」和「模型猜的」也不该混在一起。</p>
     */
    public enum AnalysisSource {
        /** 实测：切点、时长、亮度等可计算量。 */
        MEASURED("measured"),
        /** 模型判断。 */
        MODEL("model"),
        /** 用户填写。 */
        USER("user");

        private final String wire;

        AnalysisSource(String wire) {
            this.wire = wire;
        }

        @JsonValue
        public String wire() {
            return wire;
        }

        @JsonCreator
        public static AnalysisSource fromWire(String value) {
            if (value == null) {
                return null;
            }
            for (AnalysisSource s : values()) {
                if (s.wire.equals(value)) {
                    return s;
                }
            }
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "analysis source 取值无效：" + value);
        }
    }

    /**
     * 界面默认展示的六维（对账决定 E）。
     *
     * <p>包括 {@code reusable}（可借鉴点）—— 它是「能不能拿来创作」的决策字段，
     * 不能因为「不够技术」就被砍掉。</p>
     */
    public enum AnalysisKey {
        CAMERA_MOVE("cameraMove", "运镜"),
        RHYTHM("rhythm", "节奏"),
        LIGHTING("lighting", "光线"),
        COMPOSITION("composition", "构图"),
        TRANSITION("transition", "转场"),
        REUSABLE("reusable", "可借鉴点");

        private final String wire;
        private final String label;

        AnalysisKey(String wire, String label) {
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
        public static AnalysisKey fromWire(String value) {
            if (value == null) {
                return null;
            }
            for (AnalysisKey k : values()) {
                if (k.wire.equals(value)) {
                    return k;
                }
            }
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                    "analysis key 取值无效：" + value);
        }

        /** 全部维度，按界面展示顺序。 */
        public static List<AnalysisKey> ordered() {
            return List.of(values());
        }
    }
}
