package com.fengmotion.server.preset.store.mapper;

/** workflow_presets 表的一行原始数据。时间与映射保持 TEXT 原样，由仓储层转换。 */
public record WorkflowPresetRow(
        String id,
        String name,
        String description,
        String status,
        String skillPackageId,
        String sourceRepo,
        String skillPath,
        String commitSha,
        String mappingJson,
        int mappingVersion,
        String createdAt,
        String updatedAt,
        String activatedAt) {
}
