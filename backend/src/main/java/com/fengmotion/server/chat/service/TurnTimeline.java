package com.fengmotion.server.chat.service;

import java.util.ArrayList;
import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 一轮回复里思考与工具调用的先后顺序。
 *
 * <p><strong>为什么光有正文位置不够</strong>：DSH 每一步是「思考 → 正文 → 工具调用」。
 * 这一步的思考与上一步的工具调用发生在正文的同一个位置；没有正文的步骤，思考和工具也在同一位置。
 * 只按位置排，就分不清谁先谁后。所以思考段和工具调用共用一个递增的 {@code order}。</p>
 *
 * <p>只在单个回复流的线程里使用，不需要同步。</p>
 */
final class TurnTimeline {

    private record Segment(int textOffset, int order, StringBuilder text) {
    }

    private final List<Segment> segments = new ArrayList<>();
    private int nextOrder;

    /** 给工具调用分配次序；之后到达的思考另起一段。 */
    int toolOrder() {
        return nextOrder++;
    }

    /**
     * 记一段思考增量。
     *
     * <p>紧接着上一段思考、且正文位置没变时并进同一段；中间有工具调用或正文推进了，就另起一段。</p>
     *
     * @param textOffset 此刻正文的长度（UTF-16）
     * @param text       思考增量
     * @return 这段思考的次序，随实时帧下发
     */
    int reasoning(int textOffset, String text) {
        Segment last = segments.isEmpty() ? null : segments.get(segments.size() - 1);
        if (last != null && last.order() == nextOrder - 1 && last.textOffset() == textOffset) {
            last.text().append(text);
            return last.order();
        }
        Segment segment = new Segment(textOffset, nextOrder++, new StringBuilder(text));
        segments.add(segment);
        return segment.order();
    }

    /** 落库形态：{@code [{textOffset, order, text}]}；没有思考时为 null。 */
    ArrayNode toJson(ObjectMapper json) {
        ArrayNode array = json.createArrayNode();
        for (Segment segment : segments) {
            if (segment.text().toString().isBlank()) continue;
            ObjectNode node = array.addObject();
            node.put("textOffset", segment.textOffset());
            node.put("order", segment.order());
            node.put("text", segment.text().toString());
        }
        return array.isEmpty() ? null : array;
    }
}
