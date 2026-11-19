import { FX_CATEGORIES, FX_EXEC_TYPES, FX_IMPLS, FX_INPUT_TYPES, type FxCategory, type FxExecType, type FxImpl, type FxInputKind } from '@/features/fx/model/fxTechniques'

/**
 * 特效技法库 —— 按《前端下一步开发计划》§4.4（04-B）落地：
 *
 * 结构：页头（标题 + 搜索）→ 工具栏（范围 / 更多筛选 / 排序 / 视图切换）
 *       → 分类 chips →（有技术筛选时）已选条件 chips → 效果预览卡片网格
 *       （紧凑列表为可选视图）→ 点卡打开右侧详情抽屉（overlay，不常驻）。
 *
 * 与旧版的差别：三组技术筛选（执行状态 / 输入 / 实现 / 复杂度）不再常驻，
 * 收进「更多筛选」展开带，已选条件以可逐项移除的 chips 显示；
 * 分类按效果用途组织；详情抽屉按 预览 → 用途 → 实现方法 → 参数 → 调用方式 分层。
 *
 * 排版定稿（2026-10-23 与 ChatGPT 两轮对话定案，见 goals 文档《三库排版优化定案》）：
 * 单行命令条（标题+搜索+筛选按钮）+ 一行元信息（计数/已选条件/范围/排序）+ 海报墙；
 * 分类与技术条件全部收进锚定筛选按钮的浮层，即时生效；不设常驻分类条与底部状态栏。
 *
 * 能力语义：可直接执行 / 可组合 / 知识参考是**源库元数据**，逐字保留；
 * 本页不提供执行器。「用于工作流」打开目标选择弹窗：调用链未接入，
 * 选择只记入本地意向清单（fm-fx-usage-outbox-v1），不假装插入成功。
 * 收藏 / 最近使用存本地（fm-fx-library-v1）。
 *
 * 视觉只共享 A2 云端岛屿 V3 的 token（含浅白 / 触感主题根），不共享工作台骨架。
 */

export const CATEGORY_IDS = FX_CATEGORIES.map((c) => c.id)

export const EXEC_IDS = Object.keys(FX_EXEC_TYPES) as FxExecType[]

export const IMPL_IDS = Object.keys(FX_IMPLS) as FxImpl[]

export const INPUT_IDS = Object.keys(FX_INPUT_TYPES) as FxInputKind[]

export const COMPLEXITY_STEPS = [1, 2, 3, 4, 5]

export const categoryLabel = (id: FxCategory) => FX_CATEGORIES.find((c) => c.id === id)?.label ?? id

export const execLabel = (id: FxExecType) => FX_EXEC_TYPES[id].label

export const implLabel = (id: FxImpl) => FX_IMPLS[id]

export const inputLabel = (id: FxInputKind) => FX_INPUT_TYPES[id]
