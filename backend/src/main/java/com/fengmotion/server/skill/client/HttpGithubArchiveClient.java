package com.fengmotion.server.skill.client;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.fengmotion.server.common.ApiException;

/**
 * 通过 GitHub 公开接口解析 commit、下载 zip。
 *
 * <p><strong>只访问两个固定地址</strong>：{@code api.github.com}（ref → commit）和
 * {@code codeload.github.com}（按 commit 下载 zip）。不跟随重定向，避免被引到其他主机。
 * owner / repo / ref 由调用方校验过字符集，这里直接拼进路径。</p>
 *
 * <p>设置了 {@code FENGMOTION_GITHUB_TOKEN} 时带上它，以突破未登录每小时 60 次的限额。
 * token 不写入日志，也不出现在任何响应或报告里。</p>
 */
@Component
public class HttpGithubArchiveClient implements GithubArchiveClient {

    private static final String API = "https://api.github.com";
    private static final String CODELOAD = "https://codeload.github.com";

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    private final String token;

    public HttpGithubArchiveClient(@Value("${FENGMOTION_GITHUB_TOKEN:}") String token) {
        this.token = token == null ? "" : token.strip();
    }

    @Override
    public String resolveCommit(String owner, String repo, String ref) {
        String target = ref == null ? "HEAD" : ref;
        HttpRequest request = request(API + "/repos/" + owner + "/" + repo + "/commits/" + target, Duration.ofSeconds(20))
                // 这个媒体类型让接口直接返回 40 位 SHA 文本，不必解析整份 commit JSON
                .header("Accept", "application/vnd.github.sha")
                .GET().build();
        HttpResponse<String> response = send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        check(response.statusCode(), owner + "/" + repo + (ref == null ? "" : "@" + ref));
        String sha = response.body() == null ? "" : response.body().strip();
        if (!sha.matches("[0-9a-f]{40}")) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "upstream_unavailable", "GitHub 返回的 commit 格式不对，请稍后重试");
        }
        return sha;
    }

    @Override
    public InputStream openZip(String owner, String repo, String commitSha) {
        HttpRequest request = request(CODELOAD + "/" + owner + "/" + repo + "/zip/" + commitSha, Duration.ofSeconds(60))
                .GET().build();
        HttpResponse<InputStream> response = send(request, HttpResponse.BodyHandlers.ofInputStream());
        if (response.statusCode() != 200) {
            try {
                response.body().close();
            } catch (IOException ignored) {
                // 已经要报错了，关闭失败不影响结论
            }
        }
        check(response.statusCode(), owner + "/" + repo + "@" + commitSha);
        return response.body();
    }

    private HttpRequest.Builder request(String url, Duration timeout) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                .timeout(timeout)
                .header("User-Agent", "FengMotion");
        if (!token.isEmpty()) builder.header("Authorization", "Bearer " + token);
        return builder;
    }

    private <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler) {
        try {
            return http.send(request, handler);
        } catch (IOException failed) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "upstream_unavailable", "无法连接 GitHub，请检查网络后重试");
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.BAD_GATEWAY, "upstream_unavailable", "访问 GitHub 被中断");
        }
    }

    private static void check(int status, String what) {
        if (status == 200) return;
        if (status == 404 || status == 422) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "GitHub 上找不到 " + what + "（私有仓库需要配置 FENGMOTION_GITHUB_TOKEN）");
        }
        if (status == 403 || status == 429) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "upstream_unavailable", "GitHub 拒绝或限流（HTTP " + status + "），稍后重试或配置 FENGMOTION_GITHUB_TOKEN");
        }
        throw new ApiException(HttpStatus.BAD_GATEWAY, "upstream_unavailable", "GitHub 暂时不可用（HTTP " + status + "）");
    }
}
