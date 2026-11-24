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
    private static final Set<String> NAMES = Set.of("workflow", "workflow-run", "review", "editor-document", "editor-render", "creation-request", "resource-evidence", "workflow-version", "source-render-request", "workbench-job", "version-review");

    public List<Document> list(String namespace,String projectId,int limit) {
        if(!NAMES.contains(namespace) || limit<1 || limit>200) throw new ApiException(HttpStatus.BAD_REQUEST,"validation_error","文档查询参数无效");
        return jdbc.query("SELECT * FROM local_documents WHERE namespace=? AND project_id=? AND deleted=0 ORDER BY updated_at DESC, document_id LIMIT ?",(rs,row)->{
            try { return new Document(rs.getString("namespace"),rs.getString("document_id"),rs.getString("project_id"),rs.getLong("revision"),mapper.readTree(rs.getString("data")),false,rs.getString("updated_at")); }
            catch(Exception failure) { throw new IllegalStateException("本机文档无法读取",failure); }
        },namespace,projectId,limit);
    }
    @PostConstruct
    void init() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS local_documents (
              namespace TEXT NOT NULL, document_id TEXT NOT NULL, project_id TEXT,
              revision INTEGER NOT NULL, data TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL, PRIMARY KEY(namespace, document_id)
            )
            """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS idx_local_documents_project_kind ON local_documents(project_id,namespace,updated_at DESC)");
    }
    public record Document(String namespace, String id, String projectId, long revision, JsonNode data, boolean deleted, String updatedAt) {}
    public record Page(List<Document> items, String nextCursor) { }
    private record Cursor(String namespace, String id, List<String> filter, String projectId) { }

    public Page page(Set<String> namespaces, String projectId, String cursor, int limit) {
        if (namespaces.isEmpty() || !NAMES.containsAll(namespaces) || limit < 1 || limit > 200
                || projectId != null && (projectId.isBlank() || projectId.length() > 200)) throw invalidQuery();
        var ordered = namespaces.stream().sorted().toList();
        String placeholders = String.join(",", java.util.Collections.nCopies(ordered.size(), "?"));
        StringBuilder sql = new StringBuilder("SELECT * FROM local_documents WHERE namespace IN (" + placeholders + ")");
        var parameters = new java.util.ArrayList<Object>(ordered);
        if (projectId != null) { sql.append(" AND project_id=?"); parameters.add(projectId); }
        if (cursor != null) {
            Cursor decoded;
            try {
                if (cursor.length() > 4096) throw invalidQuery();
                decoded = mapper.readerFor(Cursor.class).with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY,
                        com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                        .readValue(java.util.Base64.getUrlDecoder().decode(cursor));
                if (decoded == null || !ordered.equals(decoded.filter()) || !java.util.Objects.equals(projectId, decoded.projectId())
                        || decoded.namespace() == null || !namespaces.contains(decoded.namespace()) || decoded.id() == null || decoded.id().isBlank()
                        || decoded.id().length() > 200) throw invalidQuery();
            } catch (java.io.IOException | IllegalArgumentException failure) { throw invalidQuery(); }
            sql.append(" AND (namespace>? OR (namespace=? AND document_id>?))");
            parameters.add(decoded.namespace()); parameters.add(decoded.namespace()); parameters.add(decoded.id());
        }
        sql.append(" ORDER BY namespace,document_id LIMIT ?");
        parameters.add(limit + 1);
        String boundedQuery = sql.toString().replace("SELECT *", "SELECT *, length(CAST(data AS BLOB)) AS payload_bytes");
        record Batch(List<Document> items, boolean more) { }
        var batch = jdbc.query(boundedQuery, (org.springframework.jdbc.core.ResultSetExtractor<Batch>) rows -> {
            var items = new java.util.ArrayList<Document>();
            long bytes = 0;
            int budget = maxBytes > 0 ? maxBytes : 16000000;
            while (rows.next()) {
                long size = rows.getLong("payload_bytes");
                if (items.size() == limit || !items.isEmpty() && bytes + size > budget) return new Batch(List.copyOf(items), true);
                if (size > budget) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "document_corrupt", "文档超过允许大小，请核对本机记录");
                try {
                    items.add(new Document(rows.getString("namespace"), rows.getString("document_id"), rows.getString("project_id"),
                            rows.getLong("revision"), mapper.readTree(rows.getString("data")), rows.getInt("deleted") != 0, rows.getString("updated_at")));
                } catch (java.io.IOException failure) {
                    throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "document_corrupt", "本页文档内容损坏，请核对本机记录");
                }
                bytes += size;
            }
            return new Batch(List.copyOf(items), false);
        }, parameters.toArray());
        var items = batch.items();
        String next = null;
        if (batch.more()) {
            var last = items.getLast();
            try { next = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                    mapper.writeValueAsBytes(new Cursor(last.namespace(), last.id(), ordered, projectId))); }
            catch (java.io.IOException failure) { throw new IllegalStateException("无法编码文档游标", failure); }
        }
        return new Page(items, next);
    }

    private static ApiException invalidQuery() {
        return new ApiException(HttpStatus.BAD_REQUEST, "validation_error", "文档查询参数或游标无效");
    }
    public List<Document> list() {
        return jdbc.query("SELECT * FROM local_documents ORDER BY namespace, document_id", (rs, row) -> {
            try { return new Document(rs.getString("namespace"), rs.getString("document_id"), rs.getString("project_id"), rs.getLong("revision"), mapper.readTree(rs.getString("data")), rs.getInt("deleted") != 0, rs.getString("updated_at")); }
            catch (Exception e) { throw new IllegalStateException("本机文档无法读取", e); }
        });
    }

    public List<Document> listNamespaces(Set<String> namespaces) {
        if(namespaces.isEmpty() || !NAMES.containsAll(namespaces)) throw new ApiException(HttpStatus.BAD_REQUEST,"validation_error","文档查询类型无效");
        var ordered=namespaces.stream().sorted().toList();
        String placeholders=String.join(",",java.util.Collections.nCopies(ordered.size(),"?"));
        return jdbc.query("SELECT * FROM local_documents WHERE namespace IN ("+placeholders+") ORDER BY namespace,document_id",(rs,row)->{
            try { return new Document(rs.getString("namespace"),rs.getString("document_id"),rs.getString("project_id"),rs.getLong("revision"),mapper.readTree(rs.getString("data")),rs.getInt("deleted")!=0,rs.getString("updated_at")); }
            catch(Exception failure) { throw new IllegalStateException("本机文档无法读取",failure); }
        },ordered.toArray());
    }
    public java.util.Optional<Document> find(String namespace,String id) {
        return jdbc.query("SELECT * FROM local_documents WHERE namespace=? AND document_id=?", (rs,row)->{
            try{return new Document(rs.getString("namespace"),rs.getString("document_id"),rs.getString("project_id"),rs.getLong("revision"),mapper.readTree(rs.getString("data")),rs.getInt("deleted")!=0,rs.getString("updated_at"));}
            catch(Exception e){throw new IllegalStateException("本机文档无法读取",e);}
        },namespace,id).stream().findFirst();
    }
    public synchronized Document put(String namespace, String id, String projectId, long expectedRevision, JsonNode data, boolean deleted) {
        if (!NAMES.contains(namespace) || id == null || id.isBlank() || id.length() > 200 || expectedRevision<0 || expectedRevision==Long.MAX_VALUE || data == null
                || data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > (maxBytes > 0 ? maxBytes : 16000000)) {
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
            int inserted = jdbc.update("INSERT INTO local_documents VALUES(?,?,?,?,?,?,?) ON CONFLICT(namespace,document_id) DO NOTHING", namespace,id,projectId,1,data.toString(),deleted ? 1 : 0,at);
            if (inserted != 1) throw new ApiException(HttpStatus.CONFLICT,"document_conflict","记录已由其他页面创建，请重新读取");
        } else if (jdbc.update("UPDATE local_documents SET project_id=?, revision=revision+1, data=?, deleted=?, updated_at=? WHERE namespace=? AND document_id=? AND revision=?", projectId,data.toString(),deleted ? 1 : 0,at,namespace,id,version) != 1) {
            throw new ApiException(HttpStatus.CONFLICT,"document_conflict","记录已更新，请重新读取");
        }
        return new Document(namespace,id,projectId,version+1,data,deleted,at);
    }
}
