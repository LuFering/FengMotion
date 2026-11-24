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

 @Test void versionReceiptRestoresInterruptedLegacyCreationWithoutCallingAgentAgain() throws Exception {
  var jdbc=new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("creation-recovery.db")));
  var json=new ObjectMapper();var store=new LocalStateStore(jdbc,json);
  var init=LocalStateStore.class.getDeclaredMethod("init");init.setAccessible(true);init.invoke(store);
  var creation=mock(ProjectCreationService.class);var projects=mock(ProjectRepository.class);
  var request=new CreateRequest("render",null,null,1L,null,"committed",null,null,null,null,null);
  var data=json.createObjectNode().put("state","running");data.set("request",json.valueToTree(request));
  store.put("creation-request","committed","project",0,data,false);
  when(creation.recoverRenderResult("project","committed")).thenReturn(Optional.of(new ProjectCreationService.CreateOutcome("rendered","recovered",0,"renders/result.mp4",2L,null,List.of())));
  var jobs=new CreationJobs(store,mock(CreationTaskStore.class),creation,projects,mock(CreationSessionAccess.class),json);
  try {
   var result=jobs.get("project","committed");
   assertEquals("rendered",result.state());
   assertEquals(2,result.result().path("version").asInt());
   verify(creation,never()).createThenRender(any(),any(),any(),any(),any(),any(),any(),any(),any(),any());
  } finally { jobs.close(); }
 }

 @Test void completedCreationIsNotReportedFailedWhenEvidencePersistenceFails() throws Exception {
  var jdbc=new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("evidence-failure.db")));
  var json=new ObjectMapper();var store=spy(new LocalStateStore(jdbc,json));
  var init=LocalStateStore.class.getDeclaredMethod("init");init.setAccessible(true);init.invoke(store);
  doThrow(new IllegalStateException("evidence disk error")).when(store).put(eq("resource-evidence"),anyString(),anyString(),anyLong(),any(),anyBoolean());
  var tasks=mock(CreationTaskStore.class);var creation=mock(ProjectCreationService.class);var projects=mock(ProjectRepository.class);
  when(projects.findById("project")).thenReturn(Optional.of(new Project("project","Film",null,null,dir.toString(),Instant.now())));
  var request=new CreateRequest("edit",null,null,null,null,"once",null,null,null,null,null,null,null,"draft");
  when(creation.createDraft("project",request)).thenReturn(new ProjectCreationService.CreateOutcome("edited","applied",5,null,null,null,List.of()));
  var jobs=new CreationJobs(store,tasks,creation,projects,mock(CreationSessionAccess.class),json);
  try {
   jobs.submit("project",request);
   for(int attempt=0;attempt<100&&!jobs.get("project","once").state().equals("edited");attempt++)Thread.sleep(10);
   assertEquals("edited",jobs.get("project","once").state());
   assertEquals("applied",jobs.submit("project",request).result().path("reply").asText());
   assertEquals("once",jobs.get("project","once").result().path("requestId").asText());
   assertTrue(jobs.get("project","once").result().has("width"));
   verify(creation,times(1)).createDraft("project",request);
  } finally { jobs.close(); }
 }

 @Test void queuedCreationProtectsProjectAndCancellationReleasesAdmission() throws Exception {
  var jdbc=new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("admission.db")));
  var json=new ObjectMapper();var store=new LocalStateStore(jdbc,json);
  var init=LocalStateStore.class.getDeclaredMethod("init");init.setAccessible(true);init.invoke(store);
  var tasks=mock(CreationTaskStore.class);var creation=mock(ProjectCreationService.class);
  var projects=mock(ProjectRepository.class);
  when(projects.findById(anyString())).thenAnswer(invocation -> Optional.of(new Project(invocation.getArgument(0),"Draft",null,null,dir.toString(),Instant.now())));
  var operations=new com.fengmotion.server.project.service.ProjectOperationLock();
  var jobs=new CreationJobs(store,tasks,creation,projects,mock(CreationSessionAccess.class),json,operations);
  var entered=new CountDownLatch(2);
  var finish=new CountDownLatch(1);
  when(creation.createDraft(anyString(),any())).thenAnswer(invocation -> {
   entered.countDown();finish.await(5,TimeUnit.SECONDS);
   return new ProjectCreationService.CreateOutcome("edited","done",1,null,null,null,List.of());
  });
  try {
   for(String id:List.of("one","two","queued")) {
    jobs.submit(id,new CreateRequest("edit",null,null,null,null,id,null,null,null,null,null,null,null,"draft"));
   }
   assertTrue(entered.await(3,TimeUnit.SECONDS));
   assertEquals("project_busy",assertThrows(ApiException.class,()->operations.beginDeletion("queued")).getCode());
   assertEquals("cancelled",jobs.cancel("queued","queued").state());
   try(var deletion=operations.beginDeletion("queued")) {
    var request=new CreateRequest("edit",null,null,null,null,"another",null,null,null,null,null,null,null,"draft");
    assertEquals("project_deleting",assertThrows(ApiException.class,()->jobs.submit("queued",request)).getCode());
    assertTrue(store.find("creation-request","another").isEmpty());
   }
   verify(creation,never()).createDraft(eq("queued"),any());
  } finally { finish.countDown();jobs.close(); }
 }

 @Test void editedDraftIsDurableAndExactReplayDoesNotRestartCreation() throws Exception {
  var jdbc=new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("draft.db")));
  var json=new ObjectMapper();var store=new LocalStateStore(jdbc,json);
  var init=LocalStateStore.class.getDeclaredMethod("init");init.setAccessible(true);init.invoke(store);
  var tasks=mock(CreationTaskStore.class);var creation=mock(ProjectCreationService.class);
  var projects=mock(ProjectRepository.class);
  when(projects.findById("p")).thenReturn(Optional.of(new Project("p","Draft",null,null,dir.toString(),Instant.now())));
  var request=new CreateRequest("改标题",null,null,null,null,"draft",null,null,null,null,null,null,null,"draft");
  when(creation.createDraft("p",request)).thenReturn(new ProjectCreationService.CreateOutcome("edited","工作稿已改",1,null,null,null,List.of()));
  var jobs=new CreationJobs(store,tasks,creation,projects,mock(CreationSessionAccess.class),json);
  try {
   jobs.submit("p",request);
   for(int attempt=0;attempt<100&&!jobs.get("p","draft").state().equals("edited");attempt++)Thread.sleep(20);
   assertEquals("edited",jobs.submit("p",request).state());
   assertFalse(jobs.get("p","draft").result().hasNonNull("version"));
   verify(creation,times(1)).createDraft("p",request);
   verify(creation,never()).createThenRender(any(),any(),any(),any(),any(),any(),any(),any(),any(),any());
   var afterRestart=new CreationJobs(store,tasks,creation,projects,mock(CreationSessionAccess.class),json);
   try { assertEquals("edited",afterRestart.get("p","draft").state()); }
   finally { afterRestart.close(); }
  } finally { jobs.close(); }
 }

 @Test void explicitShotRequestUsesTheShotCreationJobAndKeepsItsFormatInTheRequest() throws Exception {
  var jdbc = new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:" + dir.resolve("shot-jobs.db")));
  var json = new ObjectMapper();
  var store = new LocalStateStore(jdbc, json);
  var init = LocalStateStore.class.getDeclaredMethod("init");
  init.setAccessible(true);
  init.invoke(store);
  var tasks = mock(CreationTaskStore.class);
  var creation = mock(ProjectCreationService.class);
  var projects = mock(ProjectRepository.class);
  when(projects.findById("project")).thenReturn(Optional.of(new Project("project", "图表", null, null, dir.toString(), Instant.now())));
  var request = new CreateRequest("图表短片", null, null, 0L, null, "shots", null, null, null, null, null,
          null, "shot-timeline-v1");
  when(creation.createShotFilm("project", request)).thenReturn(
          new ProjectCreationService.CreateOutcome("rendered", "已装配", 1, "renders/shot.mp4", 1L, null, List.of()));
  var jobs = new CreationJobs(store, tasks, creation, projects, mock(CreationSessionAccess.class), json);
  try {
   jobs.submit("project", request);
   assertEquals("shot-timeline-v1", store.find("creation-request", "shots").orElseThrow().data()
           .path("request").path("filmFormat").asText());
   for (int attempt = 0; attempt < 80 && !jobs.get("project", "shots").state().equals("rendered"); attempt++) Thread.sleep(25);
   assertEquals("rendered", jobs.get("project", "shots").state());
   assertEquals(1L, jobs.submit("project", request).result().path("version").asLong());
   var changed = new CreateRequest("图表短片", null, null, 1L, null, "shots", null, null, null, null, null,
           null, "shot-timeline-v1");
   assertEquals("task_idempotency_conflict", assertThrows(ApiException.class, () -> jobs.submit("project", changed)).getCode());
   verify(creation).createShotFilm("project", request);
   verifyNoMoreInteractions(creation);
  } finally {
   jobs.close();
  }
 }
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
