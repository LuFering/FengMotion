package com.fengmotion.server.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * {@code status} 帧载荷的字段契约。
 *
 * <p>这些字段名是前后端之间的约定，拼错不会有编译错误，只会在界面上表现为
 * 「工具信息永远不显示」。所以逐个字段钉住，尤其是本轮新增的
 * {@code callId} / {@code arguments} / {@code isError}。</p>
 */
@DisplayName("status 帧载荷")
class StatusPayloadTest {

    private final ObjectMapper json = new ObjectMapper();

    @Test
    @DisplayName("思考阶段只带 type 和 phase，不夹带工具字段")
    void thinkingHasNoToolFields() {
        ObjectNode payload = ChatStreamService.statusPayload(
                json, "thinking", null, null, null, null, false);

        assertEquals("status", payload.path("type").asText());
        assertEquals("thinking", payload.path("phase").asText());
        assertFalse(payload.has("name"), "思考阶段不该有工具名");
        assertFalse(payload.has("callId"), "思考阶段不该有 callId");
        assertFalse(payload.has("arguments"), "思考阶段不该有参数");
        assertFalse(payload.has("isError"), "成功时不该写 isError");
    }

    @Test
    @DisplayName("工具开始帧带 name/label/callId/arguments")
    void toolCallCarriesStructuredFields() {
        ObjectNode payload = ChatStreamService.statusPayload(
                json, "tool", "bash", "bash", "call-1", "{\"cmd\":\"ls -la\"}", false);

        assertEquals("tool", payload.path("phase").asText());
        assertEquals("bash", payload.path("name").asText());
        assertEquals("call-1", payload.path("callId").asText());
        assertEquals("{\"cmd\":\"ls -la\"}", payload.path("arguments").asText());
        // 开始帧不是失败，不该有 isError —— 前端据此区分「开始」与「结果」
        assertFalse(payload.has("isError"));
    }

    @Test
    @DisplayName("工具结果帧只带 callId，失败时才带 isError")
    void toolResultCarriesCallIdAndErrorFlag() {
        ObjectNode ok = ChatStreamService.statusPayload(
                json, "tool", null, null, "call-2", null, false);
        assertEquals("call-2", ok.path("callId").asText());
        assertFalse(ok.has("name"), "结果帧不重复下发工具名");
        assertFalse(ok.has("isError"), "成功的工具不该有 isError");

        ObjectNode failed = ChatStreamService.statusPayload(
                json, "tool", null, null, "call-3", null, true);
        assertTrue(failed.path("isError").asBoolean(), "失败时 isError 必须为 true");
    }

    @Test
    @DisplayName("空 callId 与空参数不写进帧里")
    void blankFieldsAreOmitted() {
        ObjectNode payload = ChatStreamService.statusPayload(
                json, "tool", "bash", "bash", "", "  ", false);

        assertFalse(payload.has("callId"), "空白 callId 不该占位");
        assertFalse(payload.has("arguments"), "空白参数不该占位");
        assertTrue(payload.has("name"), "工具名仍然要有");
    }

    @Test
    @DisplayName("超长参数被截断并以省略号结尾")
    void overlongArgumentsAreTruncated() {
        String huge = "x".repeat(5000);
        ObjectNode payload = ChatStreamService.statusPayload(
                json, "tool", "write", "write", "call-4", huge, false);

        String args = payload.path("arguments").asText();
        // 4000 上限 + 一个省略号
        assertEquals(4001, args.length());
        assertTrue(args.endsWith("…"), "截断后应带省略号，让调用方知道内容不完整");
    }
}
