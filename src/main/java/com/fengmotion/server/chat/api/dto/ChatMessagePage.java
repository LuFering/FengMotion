package com.fengmotion.server.chat.api.dto;

import java.util.List;

/**
 * 一页消息查询结果。
 *
 * @param items      当前页消息，按时间正序
 * @param nextCursor 下一页游标；没有更多结果时为 null
 */
public record ChatMessagePage(
        List<ChatMessageResponse> items,
        String nextCursor) {
}
