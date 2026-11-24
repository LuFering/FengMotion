package com.fengmotion.server.creation.service;

import java.util.function.BooleanSupplier;
import org.springframework.http.HttpStatus;
import com.fengmotion.server.common.ApiException;

final class CreationCancellation {
    private static final ThreadLocal<BooleanSupplier> CURRENT = new ThreadLocal<>();

    private CreationCancellation() { }

    static Scope watch(BooleanSupplier cancelled) {
        var previous = CURRENT.get();
        CURRENT.set(cancelled);
        return new Scope(previous);
    }

    static void requireRunning() {
        var cancellation = CURRENT.get();
        if (Thread.currentThread().isInterrupted() || (cancellation != null && cancellation.getAsBoolean())) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "creation_cancelled", "创作已中断，候选未应用");
        }
    }

    record Scope(BooleanSupplier previous) implements AutoCloseable {
        @Override public void close() {
            if (previous == null) CURRENT.remove();
            else CURRENT.set(previous);
        }
    }
}
