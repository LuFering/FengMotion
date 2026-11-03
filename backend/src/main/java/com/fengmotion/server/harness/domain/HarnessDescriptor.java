package com.fengmotion.server.harness.domain;

/**
 * 一个执行引擎的对外描述。
 *
 * @param id           引擎 ID，例如 {@code dsh-sdk}
 * @param name         展示名
 * @param kind         引擎类型：{@code sdk} / {@code cli} / {@code api}
 * @param status       可用性
 * @param version      引擎版本；探测不到时为 null
 * @param note         状态说明；{@code available} 时为 null
 * @param capabilities 能力声明
 */
public record HarnessDescriptor(
        String id,
        String name,
        String kind,
        Status status,
        String version,
        String note,
        HarnessCapabilities capabilities) {

    /**
     * 引擎可用性。
     *
     * <p>三态而非布尔：{@code UNAVAILABLE} 表示依赖缺失（例如 `dsh` 不在 PATH），
     * {@code MISCONFIGURED} 表示引擎在但配置不对（例如没有可用模型路由）。
     * 两者对用户的下一步动作不同，合并成「不可用」会让排查变难。</p>
     */
    public enum Status {
        /** 可用。 */
        AVAILABLE("available"),
        /** 依赖缺失。 */
        UNAVAILABLE("unavailable"),
        /** 存在但配置不正确。 */
        MISCONFIGURED("misconfigured");

        private final String wireValue;

        Status(String wireValue) {
            this.wireValue = wireValue;
        }

        /** 对外的 JSON 值。 */
        public String wireValue() {
            return wireValue;
        }
    }
}
