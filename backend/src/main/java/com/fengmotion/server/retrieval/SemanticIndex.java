package com.fengmotion.server.retrieval;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 语义索引：把「可检索文本」写成向量，并在检索时按相似度排序。
 *
 * <p><strong>为什么存 BLOB 而不是另起向量库</strong>：规模是几百到几千条，
 * 全量内存比对一次只要几毫秒；引入向量数据库会多一个部署依赖与一套同步逻辑，
 * 换来的收益在这个量级上不存在。等条目上万再换。</p>
 *
 * <p><strong>内容哈希的作用</strong>：文本没变就不重算向量。否则每次启动/每次导入
 * 都要把全库重新调一遍 API，既慢又花钱。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SemanticIndex {

    private final JdbcTemplate jdbc;
    private final EmbeddingProvider embeddings;

    /**
     * 一条待索引文本。
     *
     * @param kind  来源：asset / reference / technique / capability
     * @param id    资源 ID
     * @param chunk 同一资源内的第几段
     * @param text  参与检索的原文
     */
    public record Doc(String kind, String id, int chunk, String text) {
    }

    /**
     * 一条检索命中。
     *
     * @param kind  来源
     * @param id    资源 ID
     * @param chunk 第几段
     * @param text  命中段的原文
     * @param score 相似度（0–1，越大越像）
     */
    public record Hit(String kind, String id, int chunk, String text, double score) {
    }

    /**
     * 索引一批文档；内容未变的跳过。
     *
     * @param docs 待索引文档
     * @return 实际新写入的段数；embedding 不可用时为 0
     */
    public int upsert(List<Doc> docs) {
        if (docs.isEmpty()) return 0;
        if (!embeddings.available()) return 0;

        /* 先挑出真正需要重算的：与库里的 content_hash 比对。
           这一步很关键 —— 全量重算在每次启动时都会烧一遍 token。 */
        List<Doc> pending = new ArrayList<>();
        for (Doc doc : docs) {
            String hash = sha256(doc.text());
            Integer exists = jdbc.query(
                    "SELECT COUNT(*) FROM semantic_index WHERE ref_kind=? AND ref_id=? AND chunk_no=? "
                            + "AND content_hash=? AND model=?",
                    rs -> rs.next() ? rs.getInt(1) : 0,
                    doc.kind(), doc.id(), doc.chunk(), hash, EmbeddingProvider.MODEL);
            if (exists == null || exists == 0) pending.add(doc);
        }
        if (pending.isEmpty()) return 0;

        List<float[]> vectors = embeddings.embed(pending.stream().map(Doc::text).toList());
        if (vectors.size() != pending.size()) {
            log.warn("向量数 {} 与待索引文本数 {} 不一致，本次不写入", vectors.size(), pending.size());
            return 0;
        }

        String now = Instant.now().toString();
        int written = 0;
        for (int i = 0; i < pending.size(); i++) {
            Doc doc = pending.get(i);
            float[] vector = vectors.get(i);
            jdbc.update("""
                    INSERT INTO semantic_index
                        (ref_kind, ref_id, chunk_no, text, content_hash, model, dim, vector, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(ref_kind, ref_id, chunk_no) DO UPDATE SET
                        text=excluded.text, content_hash=excluded.content_hash,
                        model=excluded.model, dim=excluded.dim,
                        vector=excluded.vector, updated_at=excluded.updated_at
                    """,
                    doc.kind(), doc.id(), doc.chunk(), doc.text(), sha256(doc.text()),
                    EmbeddingProvider.MODEL, vector.length, toBytes(vector), now);
            written++;
        }
        log.info("语义索引更新 {} 段（共 {} 段）", written, docs.size());
        return written;
    }

    /**
     * 语义检索。
     *
     * <p>返回值带状态，而不是单纯的列表：调用方需要区分「服务失败」「索引未就绪」
     * 和「确实没有相近内容」。把三者压成空列表，下游就会把故障说成「没有匹配」。</p>
     *
     * @param query 自然语言查询
     * @param kinds 限定来源；空表示全部
     * @param limit 最多返回条数
     * @return 带状态的检索结果
     */
    public RetrievalResult search(String query, List<String> kinds, int limit) {
        if (query == null || query.isBlank()) {
            return RetrievalResult.empty(RetrievalResult.Status.SUCCESS_NO_MATCH, query, kinds);
        }

        /* 顺序很重要：先看索引有没有内容，再看服务通不通。
           反过来的话，索引为空会被报成「服务失败」，同样误导。 */
        if (size() == 0) {
            return RetrievalResult.empty(RetrievalResult.Status.INDEX_NOT_READY, query, kinds);
        }
        if (!embeddings.available()) {
            return RetrievalResult.empty(RetrievalResult.Status.SERVICE_FAILED, query, kinds);
        }

        List<float[]> queryVector = embeddings.embed(List.of(query));
        if (queryVector.isEmpty()) {
            return RetrievalResult.empty(RetrievalResult.Status.SERVICE_FAILED, query, kinds);
        }
        float[] target = queryVector.get(0);

        String kindFilter = (kinds == null || kinds.isEmpty())
                ? ""
                : " WHERE ref_kind IN (" + String.join(",", kinds.stream().map(k -> "?").toList()) + ")";
        Object[] args = (kinds == null || kinds.isEmpty()) ? new Object[0] : kinds.toArray();

        List<Hit> hits = new ArrayList<>();
        jdbc.query("SELECT ref_kind, ref_id, chunk_no, text, vector FROM semantic_index" + kindFilter,
                rs -> {
                    while (rs.next()) {
                        float[] vector = fromBytes(rs.getBytes("vector"));
                        hits.add(new Hit(rs.getString("ref_kind"), rs.getString("ref_id"),
                                rs.getInt("chunk_no"), rs.getString("text"),
                                cosine(target, vector)));
                    }
                }, args);

        hits.sort(Comparator.comparingDouble(Hit::score).reversed());
        List<Hit> top = hits.size() > limit ? hits.subList(0, limit) : hits;
        return new RetrievalResult(
                top.isEmpty() ? RetrievalResult.Status.SUCCESS_NO_MATCH : RetrievalResult.Status.SUCCESS_WITH_HITS,
                query, kinds, List.copyOf(top));
    }

    /**
     * 索引里有多少段。
     *
     * @return 段数
     */
    public int size() {
        Integer n = jdbc.query("SELECT COUNT(*) FROM semantic_index", rs -> rs.next() ? rs.getInt(1) : 0);
        return n == null ? 0 : n;
    }

    /**
     * 余弦相似度。
     *
     * <p>两个向量长度不一致时返回 0：那说明索引与模型不同步，
     * 硬算会得到误导性的分数。</p>
     *
     * @param a 向量 A
     * @param b 向量 B
     * @return 相似度
     */
    static double cosine(float[] a, float[] b) {
        if (a == null || b == null || a.length != b.length || a.length == 0) return 0;
        double dot = 0;
        double na = 0;
        double nb = 0;
        for (int i = 0; i < a.length; i++) {
            dot += (double) a[i] * b[i];
            na += (double) a[i] * a[i];
            nb += (double) b[i] * b[i];
        }
        if (na == 0 || nb == 0) return 0;
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    private String sha256(String text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception ex) {
            return String.valueOf(text.hashCode());
        }
    }

    private byte[] toBytes(float[] vector) {
        ByteBuffer buffer = ByteBuffer.allocate(vector.length * 4).order(ByteOrder.LITTLE_ENDIAN);
        for (float v : vector) buffer.putFloat(v);
        return buffer.array();
    }

    private float[] fromBytes(byte[] bytes) {
        if (bytes == null) return new float[0];
        ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        float[] out = new float[bytes.length / 4];
        for (int i = 0; i < out.length; i++) out[i] = buffer.getFloat();
        return out;
    }
}
