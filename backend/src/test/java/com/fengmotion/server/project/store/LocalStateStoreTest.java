package com.fengmotion.server.project.store;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengmotion.server.common.ApiException;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;
class LocalStateStoreTest {
 @TempDir Path dir;
 LocalStateStore store(){var store=new LocalStateStore(new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("records.db"))),new ObjectMapper());store.init();return store;}
 @Test void filteredJobListsDoNotReadOtherNamespacesOrDeletedDocuments(){
  var store=store();var data=new ObjectMapper().createObjectNode();
  store.put("workbench-job","first","project",0,data,false);
  store.put("workbench-job","other","another-project",0,data,false);
  store.put("workbench-job","deleted","project",0,data,true);
  store.put("workflow","unrelated","project",0,data,false);
  assertEquals(1,store.list("workbench-job","project",100).size());
  assertEquals("first",store.list("workbench-job","project",100).getFirst().id());
  assertThrows(ApiException.class,()->store.list("workbench-job","project",0));
 }
 @Test void durableVersionsRetriesConflictsAndTombstones()throws Exception{
  var s=store();var json=new ObjectMapper();var first=s.put("workflow","a","p",0,json.readTree("{\"name\":\"旧\"}"),false);
  assertEquals(1,first.revision());assertEquals(1,s.put("workflow","a","p",0,first.data(),false).revision());
  var newer=s.put("workflow","a","p",1,json.readTree("{\"name\":\"新\"}"),false);assertEquals(2,newer.revision());
  assertThrows(ApiException.class,()->s.put("workflow","a","p",1,first.data(),false));
  assertEquals("新",store().list().getFirst().data().get("name").asText());
  s.put("workflow","a","p",2,newer.data(),true);assertTrue(store().list().getFirst().deleted());
 }
 @Test void namespacesAreValidatedAndSameIdDifferentKindsStaySeparate(){
  var s=store();var data=new ObjectMapper().createObjectNode();
  assertThrows(ApiException.class,()->s.put("arbitrary","a",null,0,data,false));
  s.put("workflow","a",null,0,data,false);s.put("workflow-run","a",null,0,data,false);assertEquals(2,s.list().size());
 }
 @Test void payloadLimitCountsUtf8BytesAndRejectsNegativeRevision(){
  var store=store();var json=new ObjectMapper();
  org.springframework.test.util.ReflectionTestUtils.setField(store,"maxBytes",20);
  assertThrows(ApiException.class,()->store.put("workflow","too-large",null,0,json.createObjectNode().put("text","中文中文中文"),false));
  assertThrows(ApiException.class,()->store.put("workflow","negative",null,-1,json.createObjectNode(),false));
 }
 @Test void publicDocumentQueriesDoNotDeserializeBrokenInternalJobRows(){
  var store=store();var data=new ObjectMapper().createObjectNode();
  store.put("workflow","visible",null,0,data,false);
  store.put("source-render-request","internal","project",0,data,false);
  var jdbc=new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("records.db")));
  jdbc.update("UPDATE local_documents SET data='invalid-json' WHERE document_id='internal'");
  assertEquals("visible",store.listNamespaces(java.util.Set.of("workflow")).getFirst().id());
 }
 @Test void paginationUsesStableKeysKeepsTombstonesAndBindsFilters(){
  var store=store();var data=new ObjectMapper().createObjectNode();
  store.put("workflow","a","project",0,data,false);
  store.put("workflow","b","project",0,data,true);
  store.put("workflow","c","project",0,data,false);
  store.put("workflow","other","different",0,data,false);
  store.put("workbench-job","private","project",0,data,false);
  var names=java.util.Set.of("workflow");
  var first=store.page(names,"project",null,1);
  assertEquals("a",first.items().getFirst().id());
  store.put("workflow","0-new","project",0,data,false);
  var second=store.page(names,"project",first.nextCursor(),1);
  assertEquals("b",second.items().getFirst().id());assertTrue(second.items().getFirst().deleted());
  var third=store.page(names,"project",second.nextCursor(),1);
  assertEquals("c",third.items().getFirst().id());assertNull(third.nextCursor());
  assertThrows(ApiException.class,()->store.page(names,"different",first.nextCursor(),1));
  assertThrows(ApiException.class,()->store.page(java.util.Set.of("review"),"project",first.nextCursor(),1));
  assertThrows(ApiException.class,()->store.page(names,"project","not-base64!",1));
  assertThrows(ApiException.class,()->store.page(names,"project",null,201));
  String missingNamespace=java.util.Base64.getUrlEncoder().encodeToString("{\"id\":\"a\",\"filter\":[\"workflow\"],\"projectId\":\"project\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
  assertThrows(ApiException.class,()->store.page(names,"project",missingNamespace,1));
 }
 @Test void paginationBoundsPayloadBytesAndDoesNotParseTheLookaheadRow(){
  var store=store();var data=new ObjectMapper().createObjectNode().put("text","x".repeat(40));
  store.put("workflow","a",null,0,data,false);
  store.put("workflow","b",null,0,data,false);
  store.put("workflow","c",null,0,data,false);
  org.springframework.test.util.ReflectionTestUtils.setField(store,"maxBytes",60);
  var first=store.page(java.util.Set.of("workflow"),null,null,100);
  assertEquals(1,first.items().size());assertNotNull(first.nextCursor());
  var second=store.page(java.util.Set.of("workflow"),null,first.nextCursor(),100);
  assertEquals("b",second.items().getFirst().id());
  var jdbc=new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("records.db")));
  jdbc.update("UPDATE local_documents SET data='invalid-json' WHERE document_id='b'");
  assertEquals(1,store.page(java.util.Set.of("workflow"),null,null,1).items().size());
  assertEquals("document_corrupt",assertThrows(ApiException.class,()->store.page(java.util.Set.of("workflow"),null,first.nextCursor(),1)).getCode());
 }
}
