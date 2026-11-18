package com.fengmotion.server.skill.store.mapper;

/**
 * skill_packages 表的一行原始数据。时间与报告保持 TEXT 原样，由仓储层转换。
 */
public record SkillPackageRow(
        String id,
        String owner,
        String repo,
        String requestedRef,
        String commitSha,
        String subPath,
        String rootDir,
        int fileCount,
        long totalBytes,
        String reportJson,
        String importedAt) {
}
