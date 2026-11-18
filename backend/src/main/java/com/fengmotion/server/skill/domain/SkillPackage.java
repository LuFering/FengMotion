package com.fengmotion.server.skill.domain;

import java.time.Instant;

/**
 * 一个已导入的 skill 包。
 *
 * @param id           包 ID
 * @param owner        GitHub owner（小写）
 * @param repo         GitHub 仓库名（小写）
 * @param requestedRef 导入时请求的分支 / 标签 / commit；未指定时为 null（即默认分支）
 * @param commitSha    实际固定的 40 位 commit
 * @param subPath      只导入的子目录；空串表示整个仓库
 * @param rootDir      落盘目录（绝对路径）
 * @param fileCount    文件数
 * @param totalBytes   总字节数
 * @param report       静态清点报告
 * @param importedAt   导入时间
 */
public record SkillPackage(String id, String owner, String repo, String requestedRef, String commitSha,
                           String subPath, String rootDir, int fileCount, long totalBytes,
                           SkillInventory report, Instant importedAt) {
}
