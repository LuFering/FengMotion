package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class CreateAgentProgressListenerTest {
    @Test void streamsPublicTextWithoutRepeatingFullMessageOrExposingReasoning() {
        var out = new StringBuilder();
        var listener = new CreateAgentRunner.ProgressListener(out::append);
        listener.onTextDelta("先检查");
        listener.onTextDelta("画面。");
        listener.onThinkingDelta("私有推理");
        listener.onAssistantMessage("先检查画面。", "私有推理");
        listener.onToolCall("1", "read", "参数");
        listener.onAssistantMessage("接下来调整节奏。", "私有推理");
        assertEquals("先检查画面。\n接下来调整节奏。\n", out.toString());
    }
}
