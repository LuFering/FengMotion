package com.fengmotion.server.workflow.service;

import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/** 本进程内的实时说明；仅对发起任务的项目和会话可见。 */
@Component
public class CreationProgressStore {
    private final ConcurrentHashMap<String, Entry> active = new ConcurrentHashMap<>();

    public void begin(String projectId, String sessionId, String requestId) {
        if (projectId != null && sessionId != null && requestId != null)
            active.put(projectId, new Entry(sessionId, requestId));
    }

    public void append(String projectId, String requestId, String text) {
        Entry entry = active.get(projectId);
        if (entry != null && entry.requestId.equals(requestId) && text != null && !text.isEmpty()) {
            synchronized (entry) {
                if (entry.text.length() < 12000) entry.text.append(text, 0, Math.min(text.length(), 12000 - entry.text.length()));
            }
        }
    }

    public void finish(String projectId, String requestId) {
        active.computeIfPresent(projectId, (key, entry) -> entry.requestId.equals(requestId) ? null : entry);
    }

    public Snapshot get(String projectId, String sessionId) {
        Entry entry = active.get(projectId);
        if (entry == null || !entry.sessionId.equals(sessionId)) return null;
        synchronized (entry) { return new Snapshot(entry.requestId, entry.text.toString()); }
    }

    private static final class Entry {
        final String sessionId, requestId;
        final StringBuilder text = new StringBuilder();
        Entry(String sessionId, String requestId) { this.sessionId = sessionId; this.requestId = requestId; }
    }
    public record Snapshot(String requestId, String text) { }
}
