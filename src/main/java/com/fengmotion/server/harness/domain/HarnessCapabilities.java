package com.fengmotion.server.harness.domain;

/**
 * 执行引擎的能力声明。
 *
 * <p>这些值是<strong>如实的能力</strong>，不是「希望有」的能力：前端据此决定界面表现，
 * 因此每一项都必须对应真实的接口行为。</p>
 *
 * @param streaming  流式粒度：{@code commit}（步骤提交点整段到达）或 {@code token}（逐 token）
 * @param cancel     取消方式：{@code process}（只能销毁子进程）或 {@code graceful}（协议级取消）
 * @param resume     是否支持会话续接
 * @param tools      是否具备工具调用能力
 * @param reasoning  是否产出推理内容
 */
public record HarnessCapabilities(
        Streaming streaming,
        Cancel cancel,
        boolean resume,
        boolean tools,
        boolean reasoning) {

    /**
     * 流式粒度。
     *
     * <p>{@code commit} 是 DSH SDK 通道的真实上限：文本在步骤提交时整段到达，
     * 拿不到逐 token 增量（详见 {@code docs/harness集成与接口清单.md} §1.1）。
     * 前端必须据此关闭「打字机」动画，否则会误导用户以为在实时生成。</p>
     */
    public enum Streaming {
        /** 步骤提交点：整段文本一次性到达。 */
        COMMIT("commit"),
        /** 逐 token 增量。 */
        TOKEN("token");

        private final String wireValue;

        Streaming(String wireValue) {
            this.wireValue = wireValue;
        }

        /** 对外的 JSON 值。 */
        public String wireValue() {
            return wireValue;
        }
    }

    /**
     * 取消方式。
     *
     * <p>DSH 的 SDK 协议没有 cancel 方法，官方说明「abandon a turn by closing the
     * runtime process」，因此只能是 {@code process}。标成 {@code graceful} 会让前端
     * 以为可以「优雅停止并保留部分结果」，那是假的。</p>
     */
    public enum Cancel {
        /** 只能销毁子进程。 */
        PROCESS("process"),
        /** 协议级取消。 */
        GRACEFUL("graceful");

        private final String wireValue;

        Cancel(String wireValue) {
            this.wireValue = wireValue;
        }

        /** 对外的 JSON 值。 */
        public String wireValue() {
            return wireValue;
        }
    }
}
