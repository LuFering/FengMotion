package com.fengmotion.server.chat.api.dto;

import java.util.List;

/**
 * 一页会话查询结果。
 *
 * @param items      当前页会话
 * @param nextCursor 下一页游标；没有更多结果时为 null
 */
public record ChatSessionPage(
        List<ChatSessionResponse> items,
        String nextCursor) {
}
