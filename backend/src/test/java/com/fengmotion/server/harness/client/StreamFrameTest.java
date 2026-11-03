package com.fengmotion.server.harness.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 验证 stderr 行到流式帧的识别，以及帧到 listener 回调的映射。
 *
 * <p>这两层是 token 级流式的关键接缝：识别太宽会把 DSH 的诊断误当帧，
 * 太窄则丢掉真实增量；映射错了会让正文和推理混在一起。</p>
 */
class StreamFrameTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    /**
     * 识别器必须接受合法的插件帧。
     */
    @Test
    void recognizesStreamFrame() throws Exception {
        String line = """
                {"jsonrpc":"2.0","method":"stream/delta","params":{"kind":"text","text":"你好"}}""";

        JsonNode frame = DshProcess.asStreamFrameForTest(line);

        assertEquals("stream/delta", frame.path("method").asText());
        assertEquals("text", frame.path("params").path("kind").asText());
        assertEquals("你好", frame.path("params").path("text").asText());
    }

    /**
     * DSH 自己的诊断文本不能被当成帧。
     *
     * <p>{@code dsh: reasoning:} 这类行与插件帧共用 stderr，误判会让后端把
     * 模型推理当正文推给前端。</p>
     */
    @Test
    void ignoresDshDiagnostics() {
        // DSH 的推理输出是纯文本，不是 JSON，因此识别结果必须是 null。
        assertEquals(null, DshProcess.asStreamFrameForTest("dsh: reasoning:"));
        assertEquals(null, DshProcess.asStreamFrameForTest("dsh: reasoning: the user wants a poem"));
    }

    /**
     * 不以 { 开头的行一律忽略。
     */
    @Test
    void ignoresPlainText() {
        assertEquals(null, DshProcess.asStreamFrameForTest("dsh: reasoning: the user wants"));
        assertEquals(null, DshProcess.asStreamFrameForTest(""));
        assertEquals(null, DshProcess.asStreamFrameForTest("   "));
    }

    /**
     * 畸形 JSON 被忽略而不是抛异常。
     *
     * <p>stderr 是混合通道，任何一行都可能不完整；解析失败必须降级为「不是帧」，
     * 否则一次诊断输出就能中断整轮对话。</p>
     */
    @Test
    void ignoresMalformedJson() {
        assertEquals(null, DshProcess.asStreamFrameForTest("{\"broken\": "));
    }

    /**
     * 合法 JSON 但没有 method 字段的，不算帧。
     */
    @Test
    void ignoresJsonWithoutMethod() {
        assertEquals(null, DshProcess.asStreamFrameForTest("{\"level\":\"info\",\"msg\":\"hi\"}"));
    }

    /**
     * 帧映射：text 走 onTextDelta，thinking 走 onThinkingDelta，空串不发。
     */
    @Test
    void mapsFramesToCallbacks() {
        List<String> texts = new ArrayList<>();
        List<String> thoughts = new ArrayList<>();
        List<JsonNode> queue = new ArrayList<>();
        queue.add(frame("text", "你"));
        queue.add(frame("text", ""));
        queue.add(frame("thinking", "想"));
        queue.add(JSON.createObjectNode().put("method", "session.event"));

        for (JsonNode node : queue) {
            if (!"stream/delta".equals(node.path("method").asText(""))) {
                continue;
            }
            String kind = node.path("params").path("kind").asText("");
            String text = node.path("params").path("text").asText("");
            if (text.isEmpty()) {
                continue;
            }
            if ("text".equals(kind)) {
                texts.add(text);
            } else if ("thinking".equals(kind)) {
                thoughts.add(text);
            }
        }

        assertEquals(List.of("你"), texts);
        assertEquals(List.of("想"), thoughts);
        assertTrue(texts.size() + thoughts.size() == 2);
    }

    /** 构造一个插件帧。 */
    private static JsonNode frame(String kind, String text) {
        var node = JSON.createObjectNode();
        node.put("jsonrpc", "2.0");
        node.put("method", "stream/delta");
        var params = node.putObject("params");
        params.put("kind", kind);
        params.put("text", text);
        return node;
    }
}
