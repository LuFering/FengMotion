package com.fengmotion.server.project.domain;

import java.time.Instant;

/** 当前持久化的项目基础信息；尚不是完整的 API 项目详情。 */
public record Project(
        String id, // 唯一标识
        String name, // 名称
        String genomeId, // 视频类型ID
        Long targetDurationMs, // 目标时长，单位毫秒；未设置时为 null
        String rootPath, // 项目根目录
        Instant createdAt// 项目创建时间
) {
}
