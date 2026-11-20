package com.fengmotion.server.chat.service;

final class ChatTurnTiming {

    private final long startedAt = System.nanoTime();

    private volatile long spawnedAt;

    private volatile long readyAt;

    private volatile long firstDeltaAt;

    private volatile long finishedAt;

    void markSpawned() {
        spawnedAt = System.nanoTime();
    }

    void markReady() {
        readyAt = System.nanoTime();
    }

    void markFinished() {
        finishedAt = System.nanoTime();
    }

    void markFirstDeltaIfText(com.fasterxml.jackson.databind.JsonNode frame) {
        if (firstDeltaAt != 0L) {
            return;
        }
        if (!"text".equals(frame.path("params").path("kind").asText())) {
            return;
        }
        firstDeltaAt = System.nanoTime();
    }

    long spawnMillis() {
        return millisBetween(startedAt, spawnedAt);
    }

    long handshakeMillis() {
        return millisBetween(spawnedAt, readyAt);
    }

    long firstTokenMillis() {
        return millisBetween(readyAt, firstDeltaAt);
    }

    long totalMillis() {
        long end = finishedAt == 0L ? System.nanoTime() : finishedAt;
        return millisBetween(startedAt, end);
    }

    private static long millisBetween(long from, long to) {
        if (from == 0L || to == 0L) {
            return -1L;
        }
        return (to - from) / 1_000_000L;
    }
}
