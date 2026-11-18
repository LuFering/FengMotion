package com.fengmotion.server.preset.domain;

import java.time.Instant;

/**
 * 从 skill 生成的视频类型。
 *
 * @param id             预设 ID
 * @param name           名称（与映射里的 name 一致）
 * @param description    说明（与映射里的 description 一致）
 * @param status         draft / active / archived
 * @param skillPackageId 来源 skill 包
 * @param sourceRepo     来源仓库 owner/repo（包被删除后仍可追溯）
 * @param skillPath      来源 SKILL.md 在包内的路径
 * @param commitSha      来源 commit
 * @param mapping        映射
 * @param mappingVersion 映射格式版本
 * @param createdAt      创建时间
 * @param updatedAt      最后修改时间
 * @param activatedAt    启用时间；未启用为 null
 */
public record WorkflowPreset(String id, String name, String description, String status, String skillPackageId,
                             String sourceRepo, String skillPath, String commitSha, PresetMapping mapping,
                             int mappingVersion, Instant createdAt, Instant updatedAt, Instant activatedAt) {

    public static final String DRAFT = "draft";
    public static final String ACTIVE = "active";
    public static final String ARCHIVED = "archived";
}
