// 视频类型（工作流预设）：从已导入的 skill 生成。
//
// 职责边界：模型只提出映射建议，后端逐项校验、存成草稿，用户确认后才启用；
// 启用的预设可以落地到项目（写入方法指引、组件源码、工作稿模板），由制作节点的 agent 读取。
// 内置预设仍在前端；工作流定义也仍在前端。见 docs/contracts/workflow-preset.md。
package com.fengmotion.server.preset;
