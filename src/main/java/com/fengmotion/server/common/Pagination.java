package com.fengmotion.server.common;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import org.springframework.http.HttpStatus;

/**
 * 分页参数的公共约定：每页数量范围与游标编解码。
 *
 * <p>游标对客户端必须是不透明的（契约 README §2.5：客户端不得解析）。当前实现把
 * 「下一条记录的起始位置」编码成 URL 安全、无填充的 Base64 文本；项目列表与会话列表
 * 的位置是偏移量，消息列表的位置是消息序号。把编码集中在这里，避免各服务各写一份
 * 后编码方式悄悄分叉。</p>
 */
public final class Pagination {
    /** 未显式指定时的每页数量。 */
    public static final int DEFAULT_LIMIT = 50;
    /** 每页允许的最大数量。 */
    public static final int MAX_LIMIT = 200;

    private Pagination() {
    }

    /**
     * 校验每页数量在 1 至 {@value #MAX_LIMIT} 之间。
     *
     * @param limit        每页数量
     * @param errorMessage 不合法时返回给调用方的消息
     * @throws ApiException 数量越界时抛出 400 validation_error
     */
    public static void requireValidLimit(int limit, String errorMessage) {
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", errorMessage);
        }
    }

    /**
     * 把起始位置编码为不透明游标。
     *
     * @param position 下一段读取的起始位置，不能为负
     * @return URL 安全、无填充的 Base64 文本
     */
    public static String encodeCursor(long position) {
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(Long.toString(position).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 解码游标；未提供游标时从位置 0 开始。
     *
     * @param cursor       客户端原样传回的游标
     * @param errorMessage 游标非法时返回给调用方的消息
     * @return 起始位置
     * @throws ApiException 游标不是本服务发出的格式时抛出 400 validation_error
     */
    public static long decodeCursor(String cursor, String errorMessage) {
        if (cursor == null) {
            return 0;
        }
        try {
            long position = Long.parseLong(
                    new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8));
            if (position < 0) {
                throw invalid(errorMessage);
            }
            return position;
        } catch (IllegalArgumentException ex) {
            throw invalid(errorMessage);
        }
    }

    /**
     * 解码偏移量游标，并确认可以安全地作为 {@code OFFSET} 使用。
     *
     * <p>偏移量型列表（项目、会话）的 {@code LIMIT/OFFSET} 在 SQL 中是整数；
     * 若把超出 int 范围的游标直接强转，会溢出成负数并产生错误的查询结果，
     * 因此这里把越界值当作非法游标拒绝。</p>
     *
     * @param cursor       客户端原样传回的游标
     * @param errorMessage 游标非法时返回给调用方的消息
     * @return 起始偏移量
     * @throws ApiException 游标非法或越界时抛出 400 validation_error
     */
    public static int decodeOffsetCursor(String cursor, String errorMessage) {
        long position = decodeCursor(cursor, errorMessage);
        if (position > Integer.MAX_VALUE) {
            throw invalid(errorMessage);
        }
        return (int) position;
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "validation_error", message);
    }
}
