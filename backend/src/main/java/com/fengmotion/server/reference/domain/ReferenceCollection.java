package com.fengmotion.server.reference.domain;

import java.time.Instant;
import java.util.List;

/**
 * 参考集合（契约 library.md §5）。
 *
 * <p>集合是**用户自己的整理**，成员是片段。删除集合不删片段 ——
 * 删一个用于归类的集合，不该顺手把用户标好的片段也删了。</p>
 *
 * @param id          集合 ID
 * @param name        名称
 * @param note        备注
 * @param segmentIds  成员片段
 * @param createdAt   创建时间
 * @param updatedAt   更新时间
 */
public record ReferenceCollection(
        String id,
        String name,
        String note,
        List<String> segmentIds,
        Instant createdAt,
        Instant updatedAt) {
}
