package com.fengmotion.server.project.store;

import java.util.Optional;

import com.fengmotion.server.project.domain.Project;

/** 项目持久化接口，隔离业务逻辑与具体存储实现。 */
public interface ProjectRepository {
    /** 插入新项目；重复 ID 由存储实现报告冲突。 */
    void save(Project project);

    // 根据 ID 查询项目
    Optional<Project> findById(String id); // Optional<Project> 表示查询结果可能存在，也可能不存在。

}
