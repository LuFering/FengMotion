package com.fengmotion.server.retrieval;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import lombok.extern.slf4j.Slf4j;

/**
 * 生成检索用的文本向量（阿里云 DashScope，text-embedding-v3，1024 维）。
 *
 * <p><strong>为什么用外部服务而不是本地算</strong>：本机没有可用的本地向量模型，
 * 而「抖动」「眩晕感」这类说法要能命中「多莉变焦」，靠的是语义而不是字面 ——
 * 只有真正的 embedding 能做到。</p>
 *
 * <p><strong>不可用时的态度</strong>：没有配置 key、网络失败都返回空结果，
 * 由调用方退回字面检索。<strong>不伪造向量</strong>：给一个随机或全零向量，
 * 会让检索结果看起来有、实际乱排，比降级更糟。</p>
 */
@Slf4j
@Component
public class EmbeddingProvider {

    /** 与索引表 {@code model} 列对应：换模型必须重建索引。 */
    public static final String MODEL = "text-embedding-v3";

    /** 向量维度。 */
    public static final int DIM = 1024;

    /**
     * DashScope 单次批量上限。
     *
     * <p>实测 3 条可用；官方限制 25 条/批，这里保守取 10 —— 一次超限整批失败，
     * 而失败重试的成本高于多切几批。</p>
     */
    private static final int BATCH = 10;

    private final ObjectMapper json;
    private final HttpClient http;

    @Value("${fengmotion.retrieval.embedding.api-key:}")
    private String apiKey;

    @Value("${fengmotion.retrieval.embedding.endpoint:https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings}")
    private String endpoint;

    @Value("${fengmotion.retrieval.embedding.timeout-seconds:30}")
    private long timeoutSeconds;

    public EmbeddingProvider(ObjectMapper json) {
        this.json = json;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    /**
     * 是否已配置 key。
     *
     * @return 配置了返回 true
     */
    public boolean available() {
        return apiKey != null && !apiKey.isBlank();
    }

    /**
     * 批量生成向量。
     *
     * <p>顺序与入参严格对应：调用方按 {@code texts[i]} 取 {@code result.get(i)}。</p>
     *
     * @param texts 待向量化的文本
     * @return 与入参等长的向量列表；不可用或失败时为空列表
     */
    public List<float[]> embed(List<String> texts) {
        if (texts.isEmpty()) return List.of();
        if (!available()) {
            log.debug("未配置 embedding key，跳过向量化");
            return List.of();
        }
        List<float[]> out = new ArrayList<>(texts.size());
        for (int from = 0; from < texts.size(); from += BATCH) {
            int to = Math.min(from + BATCH, texts.size());
            List<float[]> batch = embedBatch(texts.subList(from, to));
            if (batch.isEmpty()) return List.of();   // 任一批失败就整体放弃，避免半截索引
            out.addAll(batch);
        }
        return out;
    }

    /**
     * 单批请求。
     *
     * @param texts 一批文本
     * @return 向量列表；失败时为空
     */
    private List<float[]> embedBatch(List<String> texts) {
        try {
            var body = json.createObjectNode();
            body.put("model", MODEL);
            body.put("dimensions", DIM);
            var arr = body.putArray("input");
            for (String t : texts) arr.add(t);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(
                            json.writeValueAsString(body), StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> response = http.send(request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() != 200) {
                log.warn("embedding 请求失败：HTTP {} {}", response.statusCode(),
                        abbreviate(response.body()));
                return List.of();
            }
            return parse(response.body());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return List.of();
        } catch (Exception failed) {
            log.warn("embedding 请求异常：{}", failed.getMessage());
            return List.of();
        }
    }

    /**
     * 解析响应。
     *
     * @param body 响应体
     * @return 向量列表
     */
    private List<float[]> parse(String body) {
        try {
            JsonNode root = json.readTree(body);
            JsonNode data = root.path("data");
            if (!data.isArray()) return List.of();
            List<float[]> out = new ArrayList<>(data.size());
            /* 服务端不保证按 index 排序；按 index 放回去，避免向量与文本错位
               —— 错位会让检索结果全错，而且很难发现。 */
            float[][] byIndex = new float[data.size()][];
            for (JsonNode item : data) {
                int index = item.path("index").asInt(out.size());
                JsonNode values = item.path("embedding");
                if (index < 0 || index >= byIndex.length || !values.isArray()) continue;
                float[] v = new float[values.size()];
                for (int i = 0; i < v.length; i++) v[i] = (float) values.get(i).asDouble();
                byIndex[index] = v;
                out.add(v);
            }
            List<float[]> ordered = new ArrayList<>(out.size());
            for (float[] v : byIndex) if (v != null) ordered.add(v);
            return ordered;
        } catch (Exception broken) {
            log.warn("embedding 响应解析失败：{}", broken.getMessage());
            return List.of();
        }
    }

    private String abbreviate(String text) {
        if (text == null) return "";
        return text.length() <= 200 ? text : text.substring(0, 200) + "…";
    }
}
