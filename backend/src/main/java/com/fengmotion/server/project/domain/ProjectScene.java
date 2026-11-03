package com.fengmotion.server.project.domain;

import java.time.Instant;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 一个项目的场景快照（某一版本）。
 *
 * <p><strong>为什么需要它</strong>：修改任务如果只靠前端在请求里带基线，
 * 第二次修改仍会拿第一次之前的旧场景，把第一次的结果覆盖掉。
 * 项目当前场景必须由后端持有，并带版本号，条件更新才能发现冲突。</p>
 *
 * <p><strong>为什么整份存 JSON 而不逐字段建表</strong>：场景结构的演进比查询需求快，
 * 且这里的读写粒度永远是「整份」。版本号是唯一需要按值比较的字段。</p>
 *
 * @param projectId   所属项目
 * @param version     版本号，从 1 起单调递增
 * @param film        场景数据（Remotion props 形状）
 * @param taskId      产生该版本的任务；由外部导入时为 null
 * @param updatedAt   写入时间
 */
public record ProjectScene(String projectId, long version, JsonNode film, String taskId, Instant updatedAt) {

    /**
     * 是否有内容。
     *
     * @return 场景数据非空时为 true
     */
    public boolean present() {
        return film != null && !film.isNull();
    }
}
