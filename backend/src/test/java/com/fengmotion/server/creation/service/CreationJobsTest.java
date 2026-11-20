package com.fengmotion.server.creation.service;

import com.fengmotion.server.creation.store.CreationTaskStore;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.project.store.LocalStateStore;
import com.fengmotion.server.project.store.ProjectRepository;
import com.fengmotion.server.project.domain.Project;
import com.fengmotion.server.creation.domain.CreationSessionAccess;
import com.fengmotion.server.creation.domain.CreateRequest;
import com.fengmotion.server.common.ApiException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
class CreationJobsTest {
 @TempDir Path dir;
 @Test void requestLifetimeAndExactReplayDoNotDependOnClientConnection()throws Exception{
  var jdbc=new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("jobs.db")));var json=new ObjectMapper();var store=new LocalStateStore(jdbc,json);
  var init=LocalStateStore.class.getDeclaredMethod("init");init.setAccessible(true);init.invoke(store);
  var tasks=mock(CreationTaskStore.class);when(tasks.findByRequestId(anyString())).thenReturn(Optional.empty());
  var renderer=mock(ProjectCreationService.class);var projects=mock(ProjectRepository.class);when(projects.findById("p")).thenReturn(Optional.of(new Project("p","P",null,null,dir.toString(),Instant.now())));
  var gate=new CountDownLatch(1);when(renderer.createThenRender(any(),any(),any(),any(),any(),any(),any(),any(),any(),any())).thenAnswer(i->{gate.await(5,TimeUnit.SECONDS);return new ProjectCreationService.CreateOutcome("awaiting_info","请补充",1,null,null,null,List.of());});
  var jobs=new CreationJobs(store,tasks,renderer,projects,mock(CreationSessionAccess.class),json);
  var request=new CreateRequest("需求",json.createArrayNode(),null,null,null,"r",null,null,null,null,null);
  try{
   assertEquals("accepted",jobs.submit("p",request).state());jobs.submit("p",request);
   assertThrows(ApiException.class,()->jobs.submit("p",new CreateRequest("变更",null,null,null,null,"r",null,null,null,null,null)));
   gate.countDown();CreationJobs.Job result=null;
   for(int n=0;n<80;n++){result=jobs.get("p","r");if(result.state().equals("awaiting_info"))break;Thread.sleep(25);}
   assertEquals("awaiting_info",result.state());assertEquals("请补充",result.result().path("reply").asText());
   assertEquals("awaiting_info",jobs.submit("p",request).state());assertFalse(jobs.evidence("p","r").path("usageVerified").asBoolean());
   verify(renderer,times(1)).createThenRender(any(),any(),any(),any(),any(),any(),any(),any(),any(),any());
   assertThrows(ApiException.class,()->jobs.get("other","r"));
  }finally{gate.countDown();jobs.close();}
 }

 @Test void cancellationTerminatesOnlyItsOwnRoundAndReplaysTerminal()throws Exception{
  var jdbc=new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("cancel.db")));var json=new ObjectMapper();var store=new LocalStateStore(jdbc,json);var init=LocalStateStore.class.getDeclaredMethod("init");init.setAccessible(true);init.invoke(store);
  var tasks=mock(CreationTaskStore.class);when(tasks.findByRequestId(anyString())).thenReturn(Optional.empty());var renderer=mock(ProjectCreationService.class);var entered=new CountDownLatch(1);
  when(renderer.createThenRender(any(),any(),any(),any(),any(),any(),any(),any(),any(),any())).thenAnswer(i->{entered.countDown();Thread.sleep(10000);return null;});
  var projects=mock(ProjectRepository.class);when(projects.findById("p")).thenReturn(Optional.of(new Project("p","P",null,null,dir.toString(),Instant.now())));
  var jobs=new CreationJobs(store,tasks,renderer,projects,mock(CreationSessionAccess.class),json);
  var req=new CreateRequest("需求",null,null,null,null,"cancel-r",null,null,null,null,null);
  try{
   jobs.submit("p",req);assertTrue(entered.await(3,TimeUnit.SECONDS));jobs.cancel("p","cancel-r");
   CreationJobs.Job state=null;for(int i=0;i<80;i++){state=jobs.get("p","cancel-r");if(state.state().equals("cancelled"))break;Thread.sleep(25);}
   assertEquals("cancelled",state.state());assertEquals("cancelled",jobs.submit("p",req).state());
   verify(renderer,times(1)).createThenRender(any(),any(),any(),any(),any(),any(),any(),any(),any(),any());
  }finally{jobs.close();}
 }
}
