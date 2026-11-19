import { InfoCircle } from '@untitledui/icons'

/**
 * 我的素材 —— 原生多媒体素材管理器（G 深度优化版落地）。
 *
 * 职责：管理**真实文件**的索引与元数据 —— 用户导入的文件、工作流输入与生成结果；
 * 不负责镜头分析（参考片库），不负责技法定义（特效库）。
 *
 * 布局（与应用外壳图标栏共存，不再自带第二套导航语义）：
 *   页头岛（标题/搜索/视图/导入）通栏；其下三列 —— 左 = 组织岛（库 / 来源 /
 *   项目 / 智能文件夹 / 文件夹 / 标签，216px 岛屿面板，可收起），中 = 工具条（当前
 *   范围 + 类型/排序浮层，渐进披露）+ 素材画布 + 状态栏，右 = 检查器岛
 *   （选中才出现，含引用关系与内联审核，真实写回索引）。
 *
 * 数据真实性：
 *   · 内置种子 = 仓库真实文件（实测元数据）；导入 = 真实读取（尺寸/时长/缩略图），
 *     本体存 IndexedDB，刷新/重启仍在；「落盘到系统目录」未接入（不承诺）。
 *   · 授权（licenseStatus）与审核（reviewStatus）分离；未确认授权一律 unknown。
 *   · 引用（refs）只写数据里真实存在的关联；无生成溯源字段，不展示不编造。
 *   · 删除前检查引用；被项目引用的素材给出警告。批量操作全部真实生效。
 *
 * 视觉：A2 云端岛屿 V3。全部颜色/圆角/阴影/动效来自 myassets.css 的 V3 token；
 * 本文件不写任何色值（标签色点除外：数据色点，取自文件内固定调色板）。
 */

/**
 * 雪碧图里没有的图标走 Untitled UI，避免 <use> 指向不存在的 id 时渲染成空白。
 * 已知缺口：info（卡片警告角标曾因此完全不显示）。
 */
export const SPRITE_FALLBACK: Record<string, typeof InfoCircle> = {
  info: InfoCircle,
}

export function Icon({ name, className = 'ui-icon' }: { name: string; className?: string }) {
  const Fallback = SPRITE_FALLBACK[name]
  if (Fallback) return <Fallback size={12} className={className} aria-hidden="true" />
  return (
    <svg className={className} aria-hidden="true">
      <use href={`./assets/paba-icons.svg#${name}`} />
    </svg>
  )
}
