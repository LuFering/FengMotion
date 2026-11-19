package com.fengmotion.server.chat.service;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class DshTurnTextTest {
    record Change(String text, Integer replaceFrom) {}

    @Test void preservesStageTextAndAllowsSilentToolOnlySteps() {
        List<Change> changes = new ArrayList<>();
        var trace = new DshTurnText((text, from) -> changes.add(new Change(text, from)));
        trace.start(1, 1);
        trace.delta(1, 1, "session:1", "先检查");
        trace.delta(1, 1, "session:1", "文件。");
        trace.commit(1, 1, "先检查文件。");
        int firstToolsOffset = trace.offset();
        trace.start(1, 2);
        trace.commit(1, 2, "");
        assertEquals(firstToolsOffset, trace.offset());
        trace.start(1, 3);
        trace.commit(1, 3, "检查完成，开始修改。");
        trace.start(1, 4);
        trace.delta(1, 4, "session:4", "修改");
        trace.commit(1, 4, "修改通过验证。");
        assertEquals("先检查文件。\n\n检查完成，开始修改。\n\n修改通过验证。", trace.text());
        assertEquals("先检查文件。".length(), firstToolsOffset);
        assertEquals(trace.text(), changes.stream().map(Change::text).reduce("", String::concat));
        assertTrue(changes.stream().allMatch(change -> change.replaceFrom() == null));
    }

    @Test void retryReplacesOnlyUncommittedTailAndIgnoresLateDeltas() {
        List<Change> changes = new ArrayList<>();
        var trace = new DshTurnText((text, from) -> changes.add(new Change(text, from)));
        trace.commit(1, 1, "已检查标志 🎬。");
        int boundary = trace.offset();
        trace.start(1, 2);
        trace.delta(1, 1, "late", "不应重复");
        trace.delta(1, 2, "attempt-a", "未确认操作");
        trace.delta(1, 2, "attempt-b", "现在调整");
        trace.commit(1, 2, "现在调整颜色。");
        trace.delta(1, 2, "attempt-b", "迟到片段");
        trace.commit(1, 2, "现在调整颜色。");
        StringBuilder visible = new StringBuilder();
        for (Change change : changes) {
            if (change.replaceFrom() != null) visible.setLength(change.replaceFrom());
            visible.append(change.text());
        }
        assertEquals("已检查标志 🎬。\n\n现在调整颜色。", trace.text());
        assertEquals(trace.text(), visible.toString());
        assertTrue(changes.stream().anyMatch(change -> Integer.valueOf(boundary).equals(change.replaceFrom())));
    }

    @Test void durableMessagesCorrectProvisionalTextAndWorkWithoutPlugin() {
        List<Change> changes = new ArrayList<>();
        var trace = new DshTurnText((text, from) -> changes.add(new Change(text, from)));
        trace.start(1, 1);
        trace.delta(1, 1, "one", "临时内容");
        trace.commit(1, 1, "已确认内容。");
        assertEquals(new Change("已确认内容。", 0), changes.getLast());
        trace.start(1, 2);
        trace.delta(1, 2, "two", "这个尝试被撤回");
        trace.commit(1, 2, "");
        assertEquals("已确认内容。", trace.text());
        trace.commit(1, 3, "没有插件时仍显示下一阶段。");
        assertEquals("已确认内容。\n\n没有插件时仍显示下一阶段。", trace.text());
    }
}
