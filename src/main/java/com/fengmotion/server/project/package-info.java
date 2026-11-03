/**
 * 项目模块：提供项目创建、列表、详情和条件更新；删除待任务状态接入。
 *
 * 计划接口：
 *   GET /api/projects          项目列表（首页可用「最近项目」）
 *   GET /api/projects/{id}     项目详情
 *
 * 任务、产物、工作目录都挂在项目下，项目本身只存元信息与根目录指针。
 */
package com.fengmotion.server.project;
