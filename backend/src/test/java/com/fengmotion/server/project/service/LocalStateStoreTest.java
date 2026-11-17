package com.fengmotion.server.project.service;
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
}
