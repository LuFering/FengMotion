package com.fengmotion.server.chat.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.List;
import org.junit.jupiter.api.Test;
import com.fengmotion.server.common.ApiException;
import com.fengmotion.server.harness.config.HarnessProperties;
import com.fengmotion.server.harness.service.HarnessService;

class ChatSelectionTest {
    private ChatStreamService serviceWith(List<HarnessService.ModelEntry> models) {
        HarnessService harness = mock(HarnessService.class);
        when(harness.listModels(HarnessService.DSH_ID)).thenReturn(models);
        HarnessProperties properties = new HarnessProperties();
        properties.setModel("model-b");
        return new ChatStreamService(harness, null, null, null, properties, null, null, null, null, null);
    }

    private static final List<HarnessService.ModelEntry> catalog = List.of(
            new HarnessService.ModelEntry("model-b", "B", false, null, null, List.of("low", "medium", "high")),
            new HarnessService.ModelEntry("unknown", "Unknown", false, null, null, null),
            new HarnessService.ModelEntry("no-reasoning", "No reasoning", false, null, null, List.of()));

    @Test
    void onlyAcceptsModelsFromCurrentCatalogAndKnownLevels() {
        var service = serviceWith(catalog);
        assertDoesNotThrow(() -> service.validateSelection(null, null));
        assertDoesNotThrow(() -> service.validateSelection("model-b", "high"));
        assertDoesNotThrow(() -> service.validateSelection("unknown", "ultra"));
        assertThrows(ApiException.class, () -> service.validateSelection("model-b", "turbo"));
        assertThrows(ApiException.class, () -> service.validateSelection("other", null));
        assertThrows(ApiException.class, () -> service.validateSelection("", null));
        assertThrows(ApiException.class, () -> service.validateSelection(null, "  "));
    }

    @Test
    void requestedLevelDegradesToNearestSupportedLevel() {
        var service = serviceWith(catalog);
        // 模型只有 low/medium/high：max、ultra 都降到 high（逐级向下，绝不发明档位）。
        assertEquals("high", service.resolveEffort("model-b", "ultra"));
        assertEquals("high", service.resolveEffort("model-b", "max"));
        assertEquals("high", service.resolveEffort("model-b", "high"));
        assertEquals("medium", service.resolveEffort("model-b", "medium"));
        assertEquals("low", service.resolveEffort("model-b", "low"));
    }

    @Test
    void unknownCapabilityPassesThroughAndEmptyCapabilityUsesDefault() {
        var service = serviceWith(catalog);
        // 目录未声明能力（null）：无法判断，原样交给 DSH 校验。
        assertEquals("ultra", service.resolveEffort("unknown", "ultra"));
        // 目录明确给了空列表：该模型没有可调档位，用引擎默认。
        assertNull(service.resolveEffort("no-reasoning", "high"));
        // 不在五档之内 / 未选择：不发送。
        assertNull(service.resolveEffort("model-b", "turbo"));
        assertNull(service.resolveEffort("model-b", null));
    }

    @Test
    void lowRequestedOnHighOnlyModelLandsOnLowestAvailable() {
        var service = serviceWith(List.of(
                new HarnessService.ModelEntry("high-only", "High only", false, null, null, List.of("high"))));
        assertEquals("high", service.resolveEffort("high-only", "low"));
        assertNull(service.resolveEffort("high-only", null));
    }
}
