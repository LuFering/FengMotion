package com.fengmotion.server.project.service;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.springframework.stereotype.Service;
/** 提供项目目录的基础文件操作；异常由调用方处理。 */

@Service 
public class ProjectDirectoryService {

    /**
     * 确保工作区目录存在；必要时一并创建缺失的父目录。
     *
     * @param workspace 工作区目录路径
     * @return 工作区目录路径
     * @throws IOException 无法创建目录或路径已存在但不是目录
     */
    public Path ensureWorkspace(Path workspace) throws IOException {
        return Files.createDirectories(workspace);
    }

    /**
     * 创建项目目录；父目录必须存在，目标路径不得已存在。
     *
     * @param projectPath 要创建的项目目录
     * @return 创建的目录路径
     * @throws IOException 目录已存在或文件系统操作失败
     */
    public Path create(Path projectPath) throws IOException{
        return Files.createDirectory(projectPath);
    }
    /**
     * 删除指定路径，可用于清理创建失败后留下的空目录；不会递归删除内容。
     *
     * @param projectPath 要删除的路径
     * @throws IOException 路径不存在、目录非空或文件系统操作失败
     */
    public void deleteEmpty(Path projectPath) throws IOException{
        Files.delete(projectPath);
    }
}
