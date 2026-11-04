package com.fengmotion.server.fx.domain;

/**
 * 技法参数（契约 library.md §2.1 的 {@code params}）。
 *
 * <p>{@code value} 是**源库默认值**且已带单位（如 {@code "70%"}、{@code "1×"}）。
 * 存原样的字符串而不是拆成数值：不同技法单位不同，硬拆成 double 会丢掉「×」「%」这类
 * 对用户有意义的语义。</p>
 *
 * @param key   参数键
 * @param label 展示名
 * @param value 源库默认值（含单位）
 * @param hint  说明
 */
public record FxParam(String key, String label, String value, String hint) {
}
