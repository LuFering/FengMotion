package com.fengmotion.server.asset.domain;

import java.util.function.Function;

import org.springframework.http.HttpStatus;

import com.fengmotion.server.common.ApiException;

/**
 * 枚举与线上取值（wire value）的互换。
 *
 * <p>线上取值刻意与枚举名解耦：Java 枚举习惯大写，契约里是小写下划线。
 * 若直接 {@code valueOf}，一次改名就会破坏已存的数据与已发布的接口。</p>
 */
final class Enums {

    private Enums() {
    }

    /**
     * 按 wire 取值查找枚举成员。
     *
     * @param type     目标枚举类型
     * @param wireOf   枚举成员到 wire 取值的映射
     * @param value    外部传入的字符串，可为 null（表示「未提供」，返回 null）
     * @param field    字段名，用于错误消息
     * @return 对应成员；{@code value} 为 null 时返回 null
     * @throws ApiException 取值不在枚举范围内时抛出 400 validation_error
     */
    static <E extends Enum<E>> E parse(Class<E> type, Function<E, String> wireOf, String value, String field) {
        if (value == null) {
            return null;
        }
        for (E candidate : type.getEnumConstants()) {
            if (wireOf.apply(candidate).equals(value)) {
                return candidate;
            }
        }
        throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error",
                field + " 取值无效：" + value);
    }
}
