package com.fengmotion.server.project.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import lombok.RequiredArgsConstructor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;

/** 验证目录服务的创建、冲突和空目录清理行为。 */
@SpringBootTest
@ActiveProfiles("test")
@RequiredArgsConstructor(onConstructor_=@Autowired) //通过 onConstructor_ = @Autowired 加到 Lombok 生成的构造方法上
class ProjectDirectoryServiceTest {
 
    private  final ProjectDirectoryService directoryService;

    // JUnit 为每个测试提供临时目录，并在测试结束后清理。
    @TempDir 
    Path TempDir;

    /** 工作区的父目录不存在时会一并创建；重复调用不会覆盖已有文件。 */
    @Test
    void ensuresWorkspaceAndPreservesExistingFiles() throws IOException {
        Path workspace = TempDir.resolve("parent").resolve("workspace");

        assertEquals(workspace, directoryService.ensureWorkspace(workspace));
        assertTrue(Files.isDirectory(workspace));
        Path marker = Files.writeString(workspace.resolve("existing.txt"), "已有内容");

        assertEquals(workspace, directoryService.ensureWorkspace(workspace));
        assertEquals("已有内容", Files.readString(marker));
    }

    /** 创建成功后返回目标路径，且目录真实存在。 */
    @Test
    void createsProjectDirectory() throws IOException{
        Path projectPath = TempDir.resolve("my-project");

        Path createdPath = directoryService.create(projectPath);
        assertEquals(projectPath, createdPath);
        assertTrue(Files.isDirectory(projectPath));
    }

    /** 目标路径已存在时抛出冲突异常，不覆盖已有目录。 */
    @Test
    void rejectsExistingDirectory() throws IOException{
        Path projectPath = TempDir.resolve("existing-project");
        Files.createDirectory(projectPath);

        assertThrows(FileAlreadyExistsException.class,
             () -> directoryService.create(projectPath)
            );
    }

    /** 清理空目录后，该路径不再存在。 */
    @Test
    void deleteEmptyProjectDirectory() throws IOException{
        Path projectPath = TempDir.resolve("empty-project");
        Files.createDirectory(projectPath);

        directoryService.deleteEmpty(projectPath);

        assertFalse(Files.exists(projectPath));
    }

    @Test void identityJsonEscapesControlCharactersAndRejectsMalformedOrLinkedMarkers() throws Exception {
        directoryService.writeIdentity(TempDir, "project-id", "line\nbreak\t\"quote\"");
        var value = new com.fasterxml.jackson.databind.ObjectMapper().readTree(Files.readString(TempDir.resolve("project.json")));
        assertEquals("line\nbreak\t\"quote\"", value.path("name").asText());
        assertEquals("project-id", directoryService.readIdentity(TempDir).orElseThrow());
        for (String text : java.util.List.of("garbage \"id\":\"project-id\"", "{\"id\":\"project-id\",\"id\":\"other\"}", "{\"nested\":{\"id\":\"project-id\"}}")) {
            Files.writeString(TempDir.resolve("project.json"), text);
            assertTrue(directoryService.readIdentity(TempDir).isEmpty());
        }
        Files.delete(TempDir.resolve("project.json"));
        Path external = Files.writeString(TempDir.resolve("external.json"), "{\"id\":\"project-id\"}");
        Files.createSymbolicLink(TempDir.resolve("project.json"), external);
        assertTrue(directoryService.readIdentity(TempDir).isEmpty());
        assertThrows(IOException.class, () -> directoryService.writeIdentity(TempDir, "new", "name"));
        assertEquals("{\"id\":\"project-id\"}", Files.readString(external));
    }

}
