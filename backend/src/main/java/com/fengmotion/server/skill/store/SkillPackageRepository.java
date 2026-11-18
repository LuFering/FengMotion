package com.fengmotion.server.skill.store;

import java.util.List;
import java.util.Optional;

import com.fengmotion.server.skill.domain.SkillPackage;

/** skill 包登记的数据访问接口。 */
public interface SkillPackageRepository {
    void save(SkillPackage pkg);

    Optional<SkillPackage> findById(String id);

    /** 按 owner / repo / commit / 子目录查已导入的包。 */
    Optional<SkillPackage> findByIdentity(String owner, String repo, String commitSha, String subPath);

    /** 列表：{@link SkillPackage#report()} 为 null。 */
    List<SkillPackage> findAll();

    boolean delete(String id);
}
