package com.fengmotion.server.task;

import static org.junit.jupiter.api.Assertions.*;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.task.domain.Task;
import com.fengmotion.server.task.store.TaskRepository;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class TaskTerminalStateTest {
    @Autowired TaskRepository tasks;
    @Autowired ProjectRepository projects;
    @Autowired ObjectMapper json;
    @Test void terminalTaskCannotBeReopenedOrOverwrittenByLateEvents() {
        String project=UUID.randomUUID().toString();
        projects.save(new Project(project,"test",null,null,"/tmp/unused",Instant.now()));
        for(String terminal:java.util.List.of("completed","failed","cancelled")) {
            String id=UUID.randomUUID().toString();
            tasks.save(new Task(id,project,"render","queued","",json.createObjectNode(),0,"",null,null,Instant.now(),Instant.now(),null,null,null));
            if(terminal.equals("cancelled")) assertTrue(tasks.cancel(id,"cancelled"));
            else assertTrue(tasks.updateProgress(id,terminal,100,"finished",null,null,true));
            assertFalse(tasks.updateProgress(id,"building",50,"late progress",null,null,false));
            assertFalse(tasks.updateProgress(id,"failed",0,"late failure",null,"error",true));
            assertEquals(terminal,tasks.findById(id).orElseThrow().status());
        }
    }
}
