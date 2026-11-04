package com.fengmotion.server.asset.domain;

import java.time.Instant;

/**
 * 素材文件夹（契约 asset.md §3.5）。
 *
 * <p>删除文件夹不级联删素材：素材移回根目录。素材是用户的真实文件，
 * 删一个组织用的文件夹不该顺手带走文件。</p>
 *
 * @param id        稳定 ID
 * @param name      名称
 * @param createdAt 创建时间
 * @param updatedAt 更新时间
 */
public record AssetFolder(String id, String name, Instant createdAt, Instant updatedAt) {
}
