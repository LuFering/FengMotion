package com.fengmotion.server.harness.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.boot.web.context.WebServerInitializedEvent;
import org.springframework.boot.web.server.WebServer;

/** agent 进程拿到的是这次启动的真实端口，而不是指引里写死的 8080。 */
class LocalApiUrlTest {

    @Test
    void passesTheActualPortToAgentProcesses() {
        WebServer server = mock(WebServer.class);
        when(server.getPort()).thenReturn(38365);
        WebServerInitializedEvent event = mock(WebServerInitializedEvent.class);
        when(event.getWebServer()).thenReturn(server);

        LocalApiUrl apiUrl = new LocalApiUrl();
        apiUrl.onApplicationEvent(event);
        Map<String, String> environment = new HashMap<>(Map.of(LocalApiUrl.ENV, "http://127.0.0.1:8080/api"));
        apiUrl.applyTo(environment);

        assertEquals("http://127.0.0.1:38365/api", environment.get(LocalApiUrl.ENV));
    }

    @Test
    void dropsInheritedValueWhenThePortIsUnknown() {
        LocalApiUrl apiUrl = new LocalApiUrl();
        Map<String, String> environment = new HashMap<>(Map.of(LocalApiUrl.ENV, "http://127.0.0.1:8080/api"));
        apiUrl.applyTo(environment);

        assertNull(apiUrl.url());
        assertFalse(environment.containsKey(LocalApiUrl.ENV), "端口未知时不能留一个别处的旧地址");
    }
}
