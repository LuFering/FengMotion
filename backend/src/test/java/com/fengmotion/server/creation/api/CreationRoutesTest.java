package com.fengmotion.server.creation.api;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.creation.domain.CreateRequest;
import com.fengmotion.server.workflow.api.WorkflowProjectController;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class CreationRoutesTest {
    @Autowired RequestMappingHandlerMapping mappings;
    @Autowired ObjectMapper json;

    @Test void originalWorkflowUrlsRemainMappedOnceAfterSplittingControllers() {
        String base = "/api/projects/{projectId}/workflow";
        Map<String, Class<?>> expected = new LinkedHashMap<>();
        expected.put("GET " + base, WorkflowProjectController.class);
        expected.put("POST " + base + "/init", WorkflowProjectController.class);
        expected.put("POST " + base + "/corrections", WorkflowProjectController.class);
        for (String path : new String[]{"creation-progress", "creation", "creation-rounds", "unsaved-replies", "preview-image-capability", "film"}) {
            expected.put("GET " + base + "/" + path, CreationController.class);
        }
        for (String path : new String[]{"creation/{requestId}/sync-reply", "create", "render"}) {
            expected.put("POST " + base + "/" + path, CreationController.class);
        }
        expected.put("POST /api/projects/{projectId}/creation-jobs", CreationJobController.class);
        expected.put("GET /api/projects/{projectId}/creation-jobs", CreationJobController.class);
        expected.put("GET /api/projects/{projectId}/creation-jobs/{id}", CreationJobController.class);
        expected.put("GET /api/projects/{projectId}/creation-jobs/{id}/resources", CreationJobController.class);
        expected.put("POST /api/projects/{projectId}/creation-jobs/{id}/cancel", CreationJobController.class);

        for (var route : expected.entrySet()) {
            String method = route.getKey().substring(0, route.getKey().indexOf(' '));
            String path = route.getKey().substring(route.getKey().indexOf(' ') + 1);
            var handlers = mappings.getHandlerMethods().entrySet().stream()
                    .filter(entry -> entry.getKey().getPatternValues().contains(path))
                    .filter(entry -> entry.getKey().getMethodsCondition().getMethods().contains(RequestMethod.valueOf(method)))
                    .map(entry -> entry.getValue().getBeanType()).toList();
            assertEquals(java.util.List.of(route.getValue()), handlers, route.getKey());
        }
    }

    @Test void extractedCreationRequestRetainsTheWireShapeAndEngineSelection() throws Exception {
        String body = """
                {"intent":"制作片头","references":[],"previewImage":null,"baseVersion":2,
                 "correction":"缩短停顿","requestId":"request","sessionId":"session","userMessageId":"message",
                 "harness":"dsh-sdk","model":"model","reasoningEffort":"high","workflow":{"id":"wf","revision":3}}
                """;
        CreateRequest request = json.readValue(body, CreateRequest.class);
        assertEquals(json.readTree(body), json.readTree(json.writeValueAsString(request)));
        assertEquals("dsh-sdk", request.engineSelection().harness());
        assertEquals("model", request.engineSelection().model());
        assertEquals("high", request.engineSelection().reasoningEffort());
    }
}
