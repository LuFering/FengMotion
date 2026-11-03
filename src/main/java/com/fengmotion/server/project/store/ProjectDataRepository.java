package com.fengmotion.server.project.store;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** 项目详情查询及条件更新的数据访问接口。 */
public interface ProjectDataRepository {
    Optional<ProjectData> findActiveById(String id);

    List<ProjectData> findActive(String stage, String keyword, Sort sort, int limit, int offset);

    int updateIfMatch(String id, String etag, ProjectChanges changes, Instant updatedAt, String nextEtag);

    /**
     * 归档未归档的项目。
     *
     * @param id         项目 ID
     * @param archivedAt 归档时间
     * @return 受影响行数；0 表示项目不存在或已归档
     */
    int archiveIfActive(String id, Instant archivedAt);

    enum Sort { UPDATED_DESC, UPDATED_ASC, NAME_ASC }

    record ProjectData(String id, String name, String tagline, String stage, String genomeId,
                       Long targetDurationMs, String rootPath, String createdAt, String updatedAt, String etag) {}

    record ProjectChanges(String name, String tagline, String stage, String genomeId, Long targetDurationMs) {}
}
