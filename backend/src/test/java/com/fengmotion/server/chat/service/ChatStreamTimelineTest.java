package com.fengmotion.server.chat.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.harness.config.HarnessProperties;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ChatStreamTimelineTest {
    private final ObjectMapper json = new ObjectMapper();

    private ChatStreamService service() {
        return new ChatStreamService(null, null, null, null, new HarnessProperties(), null, null, null, null, json, null);
    }

    private List<JsonNode> frames(StringWriter output) {
        return output.toString().lines().filter(line -> line.startsWith("data: ")).map(line -> {
            try { return json.readTree(line.substring(6)); }
            catch (Exception failure) { throw new AssertionError(failure); }
        }).toList();
    }

    @Test void stageTextPrecedesToolsAndOffsetsStayStableAcrossToolOnlySteps() {
        var output = new StringWriter();
        var listener = service().new SseListener(new PrintWriter(output), "session", true);
        listener.onStepStarted(1, 1);
        listener.onTextDelta(1, 1, "session:1", "先检查项目。");
        listener.onAssistantMessage(1, 1, "先检查项目。", "");
        listener.onToolCall("read", "read", "{}");
        listener.onToolResult("read", "源码", false);
        listener.onStepStarted(1, 2);
        listener.onAssistantMessage(1, 2, "", "");
        listener.onToolCall("bash", "bash", "");
        listener.onToolResult("bash", "已检查", false);
        listener.onStepStarted(1, 3);
        listener.onAssistantMessage(1, 3, "检查完成，现在调整节奏。", "");
        listener.onToolCall("edit", "edit", "{}");
        listener.onToolResult("edit", "修改完成", false);
        listener.onStepStarted(1, 4);
        listener.onAssistantMessage(1, 4, "修改完成并验证通过。", "");

        List<JsonNode> sent = frames(output);
        assertEquals("delta", sent.getFirst().path("type").asText());
        assertEquals("先检查项目。", sent.getFirst().path("delta").asText());
        assertEquals("tool", sent.get(1).path("phase").asText());
        var calls = listener.collectedToolCalls();
        int boundary = "先检查项目。".length();
        assertEquals(boundary, calls.get(0).path("textOffset").asInt());
        assertEquals(boundary, calls.get(1).path("textOffset").asInt());
        assertTrue(calls.get(2).path("textOffset").asInt() > boundary);
        assertTrue(calls.get(0).path("done").asBoolean());
        assertEquals(3, sent.stream().filter(frame -> frame.path("type").asText().equals("delta")).count());
        assertTrue(sent.stream().noneMatch(frame -> frame.path("phase").asText().equals("done")));
    }

    @Test void backgroundCollectionStopsWritingButRetainsLaterStageTools() {
        var output = new StringWriter();
        var listener = service().new SseListener(new PrintWriter(output), "session", true);
        listener.onStepStarted(1, 1);
        listener.onAssistantMessage(1, 1, "先检查。", "");
        int before = output.toString().length();
        listener.detach();
        assertTrue(listener.collectAfterHandoff());
        listener.onStepStarted(1, 2);
        listener.onAssistantMessage(1, 2, "已检查，开始修改。", "");
        listener.onToolCall("edit", "edit", "{}");
        listener.onToolResult("edit", "", false);
        assertEquals(before, output.toString().length());
        assertTrue(listener.collectedToolCalls().get(0).path("done").asBoolean());
    }

    /** 流式插件逐字发思考：每段思考记下所在阶段的正文位置，并和工具调用共用 order 分先后。 */
    @Test void streamedReasoningIsSegmentedPerStageAndOrderedAgainstTools() {
        var output = new StringWriter();
        var listener = service().new SseListener(new PrintWriter(output), "session", true);
        listener.onStepStarted(1, 1);
        listener.onThinkingDelta("先看");
        listener.onThinkingDelta("目录");
        listener.onTextDelta(1, 1, "session:1", "我先检查项目。");
        listener.onAssistantMessage(1, 1, "我先检查项目。", "先看目录");
        listener.onToolCall("a", "bash", "{}");
        listener.onStepStarted(1, 2);
        listener.onThinkingDelta("没有正文的一步");
        listener.onAssistantMessage(1, 2, "", "没有正文的一步");
        listener.onToolCall("b", "bash", "{}");

        int boundary = "我先检查项目。".length();
        var segments = listener.collectedReasoningSegments();
        assertEquals(2, segments.size(), "整段推理随 assistant/message 再到一次时不能重复记段：" + segments);
        assertEquals("先看目录", segments.get(0).path("text").asText());
        assertEquals(0, segments.get(0).path("textOffset").asInt());
        assertEquals(boundary, segments.get(1).path("textOffset").asInt());

        var calls = listener.collectedToolCalls();
        int first = segments.get(0).path("order").asInt();
        int toolA = calls.get(0).path("order").asInt();
        int second = segments.get(1).path("order").asInt();
        int toolB = calls.get(1).path("order").asInt();
        assertTrue(first < toolA && toolA < second && second < toolB, "顺序应是 思考1 → 工具a → 思考2 → 工具b");
        assertEquals(boundary, calls.get(1).path("textOffset").asInt(), "第 2 步的思考与工具在同一位置，只能靠 order 分先后");

        List<JsonNode> reasoningFrames = frames(output).stream().filter(f -> f.path("type").asText().equals("reasoning")).toList();
        assertEquals(3, reasoningFrames.size());
        assertEquals(boundary, reasoningFrames.get(2).path("textOffset").asInt());
        assertEquals(second, reasoningFrames.get(2).path("order").asInt());
    }

    /** 没装流式插件：整段推理随 assistant/message 到达，排在这一步正文之前。 */
    @Test void wholeReasoningWithoutPluginLandsAtStepStart() {
        var output = new StringWriter();
        var listener = service().new SseListener(new PrintWriter(output), "session", true);
        listener.onStepStarted(1, 1);
        listener.onAssistantMessage(1, 1, "先检查。", "要先看目录");
        listener.onToolCall("a", "read", "{}");
        listener.onStepStarted(1, 2);
        listener.onAssistantMessage(1, 2, "检查完了。", "看完了");

        var segments = listener.collectedReasoningSegments();
        assertEquals(2, segments.size());
        assertEquals(0, segments.get(0).path("textOffset").asInt());
        assertEquals("先检查。".length(), segments.get(1).path("textOffset").asInt());
        assertTrue(segments.get(1).path("order").asInt() > listener.collectedToolCalls().get(0).path("order").asInt());
    }
}
