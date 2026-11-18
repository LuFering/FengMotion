package com.fengmotion.server.skill.client;

import java.io.InputStream;

/**
 * 访问 GitHub 的唯一入口：把 ref 固定成 commit，并按 commit 下载 zip。
 *
 * <p>抽成接口是为了测试不访问网络；实现只允许访问 GitHub 的两个固定地址。</p>
 */
public interface GithubArchiveClient {

    /**
     * 把分支 / 标签 / commit 解析成 40 位 commit SHA。
     *
     * @param ref 为 null 时取默认分支
     * @throws com.fengmotion.server.common.ApiException 仓库或 ref 不存在（404）、GitHub 不可用或限流（502）
     */
    String resolveCommit(String owner, String repo, String ref);

    /**
     * 下载指定 commit 的 zip。调用方负责关闭返回的流。
     *
     * @throws com.fengmotion.server.common.ApiException 不存在（404）、GitHub 不可用（502）
     */
    InputStream openZip(String owner, String repo, String commitSha);
}
