package com.fengmotion.server.creation.service;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import com.fengmotion.server.common.ApiException;

class PreviewImageValidationTest {
    @Test void acceptsJpegAndRejectsInvalidInput() {
        assertTrue(CreateAgentRunner.previewImages(null).isEmpty());
        assertEquals("image/jpeg", CreateAgentRunner.previewImages("data:image/jpeg;base64,/9j/").getFirst().mimeType());
        assertThrows(ApiException.class, () -> CreateAgentRunner.previewImages("data:image/png;base64,/9j/"));
        assertThrows(ApiException.class, () -> CreateAgentRunner.previewImages("data:image/jpeg;base64,AAAA"));
        assertThrows(ApiException.class, () -> CreateAgentRunner.previewImages("data:image/jpeg;base64,!"));
    }
}
