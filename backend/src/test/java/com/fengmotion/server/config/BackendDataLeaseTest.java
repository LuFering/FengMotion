package com.fengmotion.server.config;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class BackendDataLeaseTest {
    @TempDir Path root;
    @Test void secondBackendCannotOpenTheSameDatabaseUntilTheFirstExits() {
        Path database=root.resolve("data.db");
        try(var first=BackendDataLease.acquire(database)) {
            assertThrows(IllegalStateException.class,()->BackendDataLease.acquire(database));
            try(var independent=BackendDataLease.acquire(root.resolve("other.db"))) { assertNotNull(independent); }
        }
        try(var restarted=BackendDataLease.acquire(database)) { assertNotNull(restarted); }
    }
}
