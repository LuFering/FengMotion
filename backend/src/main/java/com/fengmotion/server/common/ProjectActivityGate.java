package com.fengmotion.server.common;

public interface ProjectActivityGate {
    Scope participate(String projectId);
    interface Scope extends AutoCloseable {
        @Override void close();
    }
}
