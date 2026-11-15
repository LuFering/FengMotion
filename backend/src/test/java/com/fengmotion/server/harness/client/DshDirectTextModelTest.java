package com.fengmotion.server.harness.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.harness.config.HarnessProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class DshDirectTextModelTest {
    @TempDir Path temp;

    private DshDirectTextModel model(String response) throws Exception {
        Path executable = temp.resolve("fake-dsh");
        Files.writeString(executable, "#!/bin/sh\nprintf '%s' '" + response + "' > \"$FENGMOTION_DIRECT_RESULT\"\n");
        assertTrue(executable.toFile().setExecutable(true));
        HarnessProperties properties = new HarnessProperties();
        properties.setBin(executable.toString());
        return new DshDirectTextModel(properties, new ObjectMapper());
    }

    private DshDirectTextModel.Request request() {
        return new DshDirectTextModel.Request("provider", "model", "system", "hello", 64, 1000);
    }

    @Test void returnsTextAndUsage() throws Exception {
        var result = model("{\"text\":\"ok\",\"usage\":{\"outputTokens\":2}}").generate(request());
        assertEquals("ok", result.text());
        assertEquals(2, result.usage().get("outputTokens").asInt());
    }

    @Test void surfacesStructuredFailure() throws Exception {
        IOException error = assertThrows(IOException.class, () -> model("{\"error\":\"MODEL_ERROR\",\"code\":\"AUTH\"}").generate(request()));
        assertEquals("DSH_DIRECT_MODEL_ERROR (AUTH)", error.getMessage());
    }

    @Test void rejectsInvalidRequestBeforeLaunch() throws Exception {
        var instance = model("{}");
        assertThrows(IllegalArgumentException.class, () -> instance.generate(new DshDirectTextModel.Request("", "m", null, "x", 1, 1)));
    }

    @Test void realProviderWhenExplicitlyEnabled() throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue("1".equals(System.getenv("FENGMOTION_LIVE_TEST")));
        HarnessProperties properties = new HarnessProperties();
        String bin = System.getenv("FENGMOTION_DSH_BIN");
        if (bin != null) properties.setBin(bin);
        String profile = System.getenv("FENGMOTION_DSH_PROFILE");
        if (profile != null) properties.setProfile(profile);
        String patch = System.getenv("FENGMOTION_DSH_PATCH");
        if (patch != null) properties.setPatch(patch);
        var result = new DshDirectTextModel(properties, new ObjectMapper()).generate(
                new DshDirectTextModel.Request("agent2api-ecs", "deepseek-v4.1-flash", null,
                        "请只回答：独立调用成功", 128, 45000));
        assertFalse(result.text().isBlank());
        System.out.println("DIRECT_MODEL_RESULT=" + result.text());
    }
}
