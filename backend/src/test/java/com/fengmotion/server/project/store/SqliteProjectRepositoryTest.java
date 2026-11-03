package com.fengmotion.server.project.store;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import com.fengmotion.server.project.domain.Project;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;


/** 验证项目在测试数据库中的保存与查询。 */
@SpringBootTest 
@ActiveProfiles ("test")
// 每个测试结束后回滚，避免测试记录留在数据库中。
@Transactional 
class SqliteProjectRepositoryTest {
    @Autowired 
    private ProjectRepository projectRepository;

    /** 验证完整项目可保存并按 ID 读取。 */
    @Test
    void saveAndFindsProject(){
        Project project = new Project(
            UUID.randomUUID().toString(),
            "测试项目",
            "genome-001",
            60000L,
            "/projects/test",
            Instant.parse("2026-01-01T10:00:00Z")
        );

        projectRepository.save(project);

        Project found = projectRepository.findById(project.id()).orElseThrow();

        assertEquals(project, found);
    }

    /** 不存在的 ID 返回空结果。 */
    @Test
    void returnEmptyWhenProjectDoesNotExist(){
        assertTrue(projectRepository.findById(UUID.randomUUID().toString()).isEmpty());
    }

    /** 数据库中的空时长读回后仍为 null，而不是零。 */
    @Test
    void preservesNullTargetDuration(){
        Project project = new Project(
            UUID.randomUUID().toString(),
            "没有目标时长的项目",
            null,
            null,
            null,
            Instant.parse("2026-01-01T10:00:00Z")
        );

        projectRepository.save(project);

        Project found = projectRepository.findById(project.id()).orElseThrow();

        assertNull(found.targetDurationMs());
        assertEquals(project, found);
    }

    
}
