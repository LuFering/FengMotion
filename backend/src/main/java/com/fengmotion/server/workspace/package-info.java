/**
 * 工作目录（待接入）。
 *
 * 计划接口：
 *   GET /api/workspaces             最近使用的工作目录
 *   目录选择走 Electron 原生对话框；Web 端如需浏览目录，再加 GET /api/workspaces/browse
 *
 * 安全边界：只允许访问配置文件里声明的根目录，禁止任意路径拼接。
 */
package com.fengmotion.server.workspace;
