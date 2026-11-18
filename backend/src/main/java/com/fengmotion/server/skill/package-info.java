// Skill 包（从 GitHub 导入的 AI Coding Agent skill）。
//
// 职责边界：按固定 commit 只读落盘，并做静态清点（skill、文件分类、脚本、import 依赖、许可证）。
// 不执行包内任何脚本，不做 AI 分析，不生成工作流或预设 —— 那些建立在清点结果之上，后续再做。
// 见 docs/contracts/skill-package.md。
package com.fengmotion.server.skill;
