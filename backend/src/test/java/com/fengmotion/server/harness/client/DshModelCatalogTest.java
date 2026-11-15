package com.fengmotion.server.harness.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.harness.config.HarnessProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class DshModelCatalogTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test void readsRuntimeFieldsAndPreservesUnknowns() throws Exception {
        var result = DshModelCatalog.parseResult(mapper.readTree("""
                {"entries":[{"id":"a","label":"A","contextWindow":1000,"maxTokens":42,
                "reasoningEfforts":["off","high"]},{"id":"b"}]}
                """));
        assertEquals(new DshModelCatalog.Entry("a", "A", 1000L, 42L, List.of("off", "high")), result.get(0));
        assertEquals(new DshModelCatalog.Entry("b", "b", null, null, null), result.get(1));
        assertTrue(DshModelCatalog.parseResult(mapper.readTree("{\"error\":\"BRIDGE_FAILURE\"}")).isEmpty());
    }

    @Test void processFailureAndTimeoutReturnPromptly(@TempDir Path dir) throws Exception {
        HarnessProperties p = new HarnessProperties();
        p.setBin("/bin/sh");
        p.setProfile("ignored");
        p.setProbeTimeoutMs(200);
        assertTrue(new DshModelCatalog(p).read("p").isEmpty());
        Path script = dir.resolve("hang.sh");
        Files.writeString(script, "#!/bin/sh\nexec sleep 30\n");
        assertTrue(script.toFile().setExecutable(true));
        p.setBin(script.toString());
        long start = System.nanoTime();
        assertTrue(new DshModelCatalog(p).read("p").isEmpty());
        assertTrue((System.nanoTime() - start) / 1_000_000 < 3000);
    }
}
