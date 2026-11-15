package com.fengmotion.server.workflow.service;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class CreationProgressStoreTest {
    @Test void progressIsScopedAndLateCompletionCannotClearNextTask() {
        var store = new CreationProgressStore();
        store.begin("project", "session-a", "first");
        store.append("project", "first", "先检查 ");
        store.append("project", "first", "画面。");
        assertEquals("先检查 画面。", store.get("project", "session-a").text());
        assertNull(store.get("project", "session-b"));
        assertNull(store.get("other-project", "session-a"));
        store.begin("project", "session-b", "second");
        store.append("project", "first", "过期消息");
        store.finish("project", "first");
        assertEquals("", store.get("project", "session-b").text());
        store.finish("project", "second");
        assertNull(store.get("project", "session-b"));
    }
}
