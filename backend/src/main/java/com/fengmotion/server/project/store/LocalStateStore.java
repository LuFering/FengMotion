package com.fengmotion.server.project.store;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.HttpStatus;
import com.fengmotion.server.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;

/** Durable local application documents. Revisions prevent browser caches overwriting newer data. */
@Service
@RequiredArgsConstructor
public class LocalStateStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    @org.springframework.beans.factory.annotation.Value("${fengmotion.local-documents.max-bytes:16000000}")
    private int maxBytes;
    private static final Set<String> NAMES = Set.of("workflow", "workflow-run", "review", "editor-document", "editor-render", "creation-request", "resource-evidence", "workflow-version");
    @PostConstruct
    void init() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS local_documents (
              namespace TEXT NOT NULL, document_id TEXT NOT NULL, project_id TEXT,
              revision INTEGER NOT NULL, data TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL, PRIMARY KEY(namespace, document_id)
            )
            """);
    }
    public record Document(String namespace, String id, String projectId, long revision, JsonNode data, boolean deleted, String updatedAt) {}
    public List<Document> list() {
        return jdbc.query("SELECT * FROM local_documents ORDER BY namespace, document_id", (rs, row) -> {
            try { return new Document(rs.getString("namespace"), rs.getString("document_id"), rs.getString("project_id"), rs.getLong("revision"), mapper.readTree(rs.getString("data")), rs.getInt("deleted") != 0, rs.getString("updated_at")); }
            catch (Exception e) { throw new IllegalStateException("本机文档无法读取", e); }
        });
    }
    public java.util.Optional<Document> find(String namespace,String id) {
        return jdbc.query("SELECT * FROM local_documents WHERE namespace=? AND document_id=?", (rs,row)->{
            try{return new Document(rs.getString("namespace"),rs.getString("document_id"),rs.getString("project_id"),rs.getLong("revision"),mapper.readTree(rs.getString("data")),rs.getInt("deleted")!=0,rs.getString("updated_at"));}
            catch(Exception e){throw new IllegalStateException("本机文档无法读取",e);}
        },namespace,id).stream().findFirst();
    }
    public synchronized Document put(String namespace, String id, String projectId, long expectedRevision, JsonNode data, boolean deleted) {
        if (!NAMES.contains(namespace) || id == null || id.isBlank() || id.length() > 200 || data == null || data.toString().length() > (maxBytes > 0 ? maxBytes : 16000000)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文档类型、身份或大小无效");
        }
        var old = jdbc.query("SELECT revision, data, project_id, deleted FROM local_documents WHERE namespace=? AND document_id=?", (rs, row) -> new Object[]{rs.getLong(1), rs.getString(2), rs.getString(3), rs.getInt(4)}, namespace, id);
        long version = old.isEmpty() ? 0 : (Long)old.getFirst()[0];
        // Equal retries are successful even after a lost response.
        if (!old.isEmpty() && data.toString().equals(old.getFirst()[1]) && java.util.Objects.equals(projectId, old.getFirst()[2]) && (deleted ? 1 : 0) == (Integer)old.getFirst()[3]) {
            return new Document(namespace, id, projectId, version, data, deleted, jdbc.queryForObject("SELECT updated_at FROM local_documents WHERE namespace=? AND document_id=?", String.class, namespace, id));
        }
        if(!old.isEmpty() && namespace.equals("workflow-version"))throw new ApiException(HttpStatus.CONFLICT,"document_conflict","已保存的工作流版本快照不能覆盖");
        if (version != expectedRevision) throw new ApiException(HttpStatus.CONFLICT, "document_conflict", "这份记录已在其他页面更新。本次更改已保留在浏览器备份，请重新读取后核对。");
        String at = Instant.now().toString();
        if (version == 0) {
            try { jdbc.update("INSERT INTO local_documents VALUES(?,?,?,?,?,?,?)", namespace,id,projectId,1,data.toString(),deleted ? 1 : 0,at); }
            catch (org.springframework.dao.DuplicateKeyException e) { throw new ApiException(HttpStatus.CONFLICT,"document_conflict","记录已由其他页面创建，请重新读取"); }
        } else if (jdbc.update("UPDATE local_documents SET project_id=?, revision=revision+1, data=?, deleted=?, updated_at=? WHERE namespace=? AND document_id=? AND revision=?", projectId,data.toString(),deleted ? 1 : 0,at,namespace,id,version) != 1) {
            throw new ApiException(HttpStatus.CONFLICT,"document_conflict","记录已更新，请重新读取");
        }
        return new Document(namespace,id,projectId,version+1,data,deleted,at);
    }
}
