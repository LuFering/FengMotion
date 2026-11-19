/**
 * FengMotion 前后端 API 契约 —— 全量类型（纯类型，零 import、零运行时、零实现）。
 *
 * 覆盖域：
 * - 通用与错误、分页、能力声明
 * - 项目 / 时间线 / 场景 / 分镜 / 镜头参数 / 产物 / 版本
 * - 任务、事件流、变更集
 * - 工作流定义与运行、模板
 * - 检查运行与问题项
 * - 渲染、产物、交付与验收
 * - 素材、文件夹、上传
 * - 特效库 / 参考片库 / 片型画像
 * - 对话会话与消息流
 * - 设置与能力
 *
 * 口径来源：
 * - docs/contracts/README.md（总则、端点总表、跨域状态机）
 * - docs/contracts/{project,task,workflow,check,render,asset,library,agent,settings}.md
 *
 * 冻结规则：字段与枚举只增不改义；新语义新增字段或枚举值，旧值标注废弃并给迁移期。
 * 本文件只做转发：各领域类型在 api/types/ 下按文件拆开，彼此只用 import type 互相引用，
 * 不得出现实现代码——后端、适配器、视图共用这一份类型。旧的 import 路径保持不变。
 */

export type * from './types/common' // 通用
export type * from './types/resource' // 资源状态（五维正交）
export type * from './types/project' // 项目
export type * from './types/task' // 任务
export type * from './types/workflow' // 工作流
export type * from './types/check' // 检查
export type * from './types/render' // 渲染与交付
export type * from './types/asset' // 素材
export type * from './types/library' // 知识库
export type * from './types/chat' // 对话
export type * from './types/stream' // 流式协议
