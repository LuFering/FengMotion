package com.fengmotion.server.project.api.dto;

/** 创建项目时接收的请求字段；目标时长以毫秒为单位。
 * 
 * @param name 项目名称
 * @param genomeId 视频类型ID
 * @param targetDurationMs 目标时长，单位毫秒
 * @param rootPath 项目根目录的绝对路径
 */
public record CreateProjectRequest( // record 会自动生成保存字段、构造方法，以及读取字段的方法。
        String name, 
        String genomeId, 
        Long targetDurationMs, 
        String rootPath 
) {
}
