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
     * 语义命中的最低相似度。
     *
     * <p>实测依据：相关查询（「镜头快速推近、背景被拉开的眩晕感」→ 多莉变焦）
     * 得分在 0.65–0.72；完全无关的查询（「量子纠缠猫咪太空歌剧」）最高也到 0.48。
     * 取 0.55 落在两者之间，且相关结果仍有充足余量。</p>
     *
     * <p>这个值是经验值，不是理论值：换 embedding 模型或换语料后必须重测，
     * 否则会出现「阈值偏高导致漏召回」或「偏低导致噪声回归」。分档见
     * {@code docs/research/reference-multiframe-analysis.md} 的同类记录习惯。</p>
     */
    static final double MIN_SEMANTIC_SCORE = 0.55;

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

        /* 先清掉本轮语料里已经不存在、且未被重写的旧条目。
           不做这一步的话，源文件删掉或改名后旧索引会永远留着：
           用户搜到一个「ATTRIBUTION」或已删除的镜头卡，点进去发现文件不存在。
           这正是「索引与磁盘脱节」的由来。

           只清理本轮语料覆盖到的 kind：asset/reference/technique 由各自的服务维护，
           在 capabilities 重建时不该顺手抹掉。 */
        removeStale(docs);

        /* 再挑出真正需要重算的：与库里的 content_hash 比对。
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
     * 删除本轮语料里已不存在的旧条目。
     *
     * <p>只处理本次 {@code docs} 出现过的 kind：素材、参考片、特效由各自服务维护，
     * 在重建能力库索引时把它们一起删掉会造成「检索忽然少了东西」。</p>
     *
     * <p>判定方式是「库里存在、但本轮语料不再包含这个 ref_id」。
     * 命中时直接按 {@code (kind, ref_id)} 删除该资源的全部段，
     * 避免残留一半旧段导致文字与向量错位。</p>
     *
     * @param docs 本轮语料
     */
    private void removeStale(List<Doc> docs) {
        java.util.Set<String> kinds = new java.util.HashSet<>();
        java.util.Set<String> liveIds = new java.util.HashSet<>();
        for (Doc doc : docs) {
            kinds.add(doc.kind());
            liveIds.add(doc.kind() + "\u0000" + doc.id());
        }
        if (kinds.isEmpty()) return;

        String placeholders = String.join(",", kinds.stream().map(k -> "?").toList());
        List<String> stale = new ArrayList<>();
        jdbc.query("SELECT DISTINCT ref_kind, ref_id FROM semantic_index WHERE ref_kind IN ("
                        + placeholders + ")",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                    String key = rs.getString("ref_kind") + "\u0000" + rs.getString("ref_id");
                    if (!liveIds.contains(key)) {
                        stale.add(key);
                    }
                }, kinds.toArray());

        if (stale.isEmpty()) return;
        int removed = 0;
        for (String key : stale) {
            String[] parts = key.split("\u0000", 2);
            removed += jdbc.update("DELETE FROM semantic_index WHERE ref_kind=? AND ref_id=?",
                    parts[0], parts[1]);
        }
        log.info("语义索引清理 {} 段已失效条目（对应的源已不存在或已改名）", removed);
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
            /* 没有 key 不等于「查不了」：索引表里存着当初写入的原文，
               这些原文可以按字面匹配。此时如实标成降级，而不是把整个检索判成失败 ——
               用户至少还能凭字面找到东西，也知道这次不是语义匹配。 */
            return literalFallback(query, kinds, limit);
        }

        List<float[]> queryVector = embeddings.embed(List.of(query));
        if (queryVector.isEmpty()) {
            /* 配了 key 但调用失败（网络、超时、额度）：同样退回字面，
               并保持降级状态。只报 SERVICE_FAILED 会让用户失去全部检索能力。 */
            log.warn("向量化失败，检索退回字面匹配：query={}", abbreviate(query));
            return literalFallback(query, kinds, limit);
        }
        float[] target = queryVector.get(0);

        String kindFilter = (kinds == null || kinds.isEmpty())
                ? ""
                : " WHERE ref_kind IN (" + String.join(",", kinds.stream().map(k -> "?").toList()) + ")";
        Object[] args = (kinds == null || kinds.isEmpty()) ? new Object[0] : kinds.toArray();

        List<Hit> hits = new ArrayList<>();
        jdbc.query("SELECT ref_kind, ref_id, chunk_no, text, vector FROM semantic_index" + kindFilter,
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                    float[] vector = fromBytes(rs.getBytes("vector"));
                    double score = cosine(target, vector);
                    /* 低于阈值的直接丢掉。不设阈值时任何查询都会有「命中」：
                       实测查「量子纠缠猫咪太空歌剧」，库里的甩镜头、雨滴叠加也能拿到 0.48
                       并被当成结果返回。用户会以为库里真有相关内容 —— 这比返回空更糟，
                       因为空至少是诚实的。 */
                    if (score < MIN_SEMANTIC_SCORE) {
                        return;
                    }
                    hits.add(new Hit(rs.getString("ref_kind"), rs.getString("ref_id"),
                            rs.getInt("chunk_no"), rs.getString("text"), score));
                }, args);

        hits.sort(Comparator.comparingDouble(Hit::score).reversed());
        List<Hit> top = hits.size() > limit ? hits.subList(0, limit) : hits;
        return new RetrievalResult(
                top.isEmpty() ? RetrievalResult.Status.SUCCESS_NO_MATCH : RetrievalResult.Status.SUCCESS_WITH_HITS,
                query, kinds, List.copyOf(top));
    }

    /**
     * 字面兜底：在索引原文里按关键词匹配。
     *
     * <p>这不是「凑一个结果」：索引表的 {@code text} 列存的就是当初写入索引的原文
     * （技法说明、风格描述、镜头卡正文），语义服务不可用时它依然可读可搜。
     * 只是匹配方式是字面包含，不懂同义词 —— 所以结果必须标成降级。</p>
     *
     * <p><strong>切词方式</strong>：没有引入分词器。做法是把查询按非字母数字/非汉字切块，
     * 每块长度 ≥2 才参与匹配，打分按「命中了几个词块」排。这样
     * 「镜头快速推近 眩晕」里的「镜头」「推近」「眩晕」都能各自命中，
     * 比整句 {@code LIKE} 实用得多，也不引入中文分词的依赖与调参成本。</p>
     *
     * @param query 查询文本
     * @param kinds 限定来源；空表示全部
     * @param limit 最多返回条数
     * @return 带降级状态的检索结果
     */
    private RetrievalResult literalFallback(String query, List<String> kinds, int limit) {
        List<String> terms = splitTerms(query);
        if (terms.isEmpty()) {
            /* 查询切不出可用词块（例如全是单个汉字或标点）：确实没法字面匹配，
               此时说「服务失败」是诚实的 —— 我们没能执行任何检索。 */
            return RetrievalResult.empty(RetrievalResult.Status.SERVICE_FAILED, query, kinds);
        }

        String kindFilter = (kinds == null || kinds.isEmpty())
                ? ""
                : " WHERE ref_kind IN (" + String.join(",", kinds.stream().map(k -> "?").toList()) + ")";
        Object[] args = (kinds == null || kinds.isEmpty()) ? new Object[0] : kinds.toArray();

        List<Hit> hits = new ArrayList<>();
        /* 这里必须用一个显式类型的 RowCallbackHandler，而不是裸 lambda：
           JdbcTemplate 同时有 query(String, RowCallbackHandler, Object...) 和
           query(String, ResultSetExtractor, Object...) 两个重载，而两者都是函数式接口。
           裸 lambda + Object[] 变参时，编译器/运行时的重载选择会落到 ResultSetExtractor
           分支，随后在 Tomcat 线程里抛 NoClassDefFoundError（日志框架自身又崩掉，
           真正的异常被吞掉，接口只会返回空响应）。实测过：不带 kinds 正常、
           一带 kinds 就整个请求挂掉。

           显式声明类型即可消除歧义，且 rowCallback 里不要自己 while(rs.next())。 */
        jdbc.query("SELECT ref_kind, ref_id, chunk_no, text FROM semantic_index" + kindFilter,
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                    String text = rs.getString("text");
                    int matched = countMatchedTerms(text, terms);
                    if (matched == 0) {
                        return;
                    }
                    /* 分数 = 命中词块占比。语义相似度在 0–1 之间连续分布，
                       字面占比也是 0–1，形状接近但含义不同；
                       调用方靠 status 区分，不靠分数。 */
                    double score = (double) matched / terms.size();
                    hits.add(new Hit(rs.getString("ref_kind"), rs.getString("ref_id"),
                            rs.getInt("chunk_no"), text, score));
                }, args);

        hits.sort(Comparator.comparingDouble(Hit::score).reversed());
        List<Hit> top = hits.size() > limit ? hits.subList(0, limit) : hits;
        return new RetrievalResult(
                top.isEmpty()
                        ? RetrievalResult.Status.DEGRADED_LITERAL_NO_MATCH
                        : RetrievalResult.Status.DEGRADED_LITERAL_WITH_HITS,
                query, kinds, List.copyOf(top));
    }

    /**
     * 把查询切成参与字面匹配的词块。
     *
     * <p>中文没有空格，所以这里不能只按标点切 —— 实测踩到过：
     * 查询「镜头快速推近、背景被拉开的眩晕感」按标点切成整块
     * 「镜头快速推近」和「背景被拉开的眩晕感」，而索引里写的是「多莉变焦」，
     * 整块做子串匹配永远不命中，于是降级后依然是一条结果都没有。</p>
     *
     * <p>规则因此是：<strong>连续的中日韩文字切成长度 2 的二元组</strong>，
     * 拉丁字母数字仍按词切（≥2 字符）。二元组是中文检索的常用近似：
     * 「眩晕感」→「眩晕」「晕感」，只要原文出现「眩晕」就能命中，
     * 又不会像单字那样到处误命中。</p>
     */
    static List<String> splitTerms(String query) {
        if (query == null || query.isBlank()) {
            return List.of();
        }
        List<String> terms = new ArrayList<>();
        int i = 0;
        while (i < query.length()) {
            char c = query.charAt(i);
            if (isCjk(c)) {
                int start = i;
                while (i < query.length() && isCjk(query.charAt(i))) {
                    i++;
                }
                addCjkBigrams(terms, query.substring(start, i));
            } else if (Character.isLetterOrDigit(c)) {
                int start = i;
                while (i < query.length()
                        && Character.isLetterOrDigit(query.charAt(i))
                        && !isCjk(query.charAt(i))) {
                    i++;
                }
                addIfUseful(terms, query.substring(start, i));
            } else {
                i++;
            }
        }
        return terms;
    }

    /** 是否中日韩文字（含扩展 A 与兼容区）。 */
    private static boolean isCjk(char c) {
        return (c >= 0x4E00 && c <= 0x9FFF)
                || (c >= 0x3400 && c <= 0x4DBF)
                || (c >= 0xF900 && c <= 0xFAFF);
    }

    /**
     * 把一段连续中文切成二元组。
     *
     * <p>只有 2 个字时直接用整段（切不出二元组，但整段本身就是有效词）。
     * 单字不单独成词 —— 单字匹配误命中太多，会把真正的结果挤出榜单。</p>
     */
    private static void addCjkBigrams(List<String> terms, String run) {
        if (run.length() == 1) {
            return;
        }
        if (run.length() == 2) {
            addIfUseful(terms, run);
            return;
        }
        for (int i = 0; i + 2 <= run.length(); i++) {
            addIfUseful(terms, run.substring(i, i + 2));
        }
    }

    private static void addIfUseful(List<String> terms, String term) {
        String trimmed = term.trim();
        if (trimmed.length() >= 2 && !terms.contains(trimmed)) {
            terms.add(trimmed);
        }
    }

    /** 文本里命中了几个词块（不区分大小写）。 */
    private static int countMatchedTerms(String text, List<String> terms) {
        if (text == null || text.isEmpty()) {
            return 0;
        }
        String lower = text.toLowerCase(java.util.Locale.ROOT);
        int matched = 0;
        for (String term : terms) {
            if (lower.contains(term.toLowerCase(java.util.Locale.ROOT))) {
                matched++;
            }
        }
        return matched;
    }

    /** 日志里用的短查询：避免整段 prompt 进日志。 */
    private static String abbreviate(String query) {
        return query.length() <= 40 ? query : query.substring(0, 40) + "…";
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
