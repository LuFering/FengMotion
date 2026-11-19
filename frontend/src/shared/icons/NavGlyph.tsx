import {
  ChevronRight,
  Dataflow02,
  DotsHorizontal,
  Film01,
  Home02,
  Image01,
  MessageCircle01,
  Settings01,
  Users03,
} from '@untitledui/icons'
import { UiIcon, type UntIcon } from './UiIcon'

/**
 * 导航图标映射 —— Untitled UI Icons。
 *
 * 选型经过三轮实测截图对比（lucide → Phosphor → Untitled UI）：
 *   · lucide      方头端点，20px 下发硬；
 *   · Phosphor   曲线偏软，「工作流」连线东倒西歪、「社区」三人挤成一团；
 *   · Untitled UI 产品设计师逐像素绘制，线条均匀、比例克制，最接近
 *                 Figma / Linear 那种「看不出设计过、但就是舒服」的质感。
 *
 * 语义修正（改造前 'messages-square' 容易被读成「消息」而非「作品」）：
 *   首页     Home02             带门的房屋，比抽象方块更易读
 *   我的创作  MessageCircle01    单气泡：与其它图标墨量均衡（双气泡在 20px 下偏重）
 *   工作流   Dataflow02         节点 + 连线，正是工作流画布的抽象
 *   社区     Users03            双人轮廓，明确是「人」而非「方框叠方框」
 *   更多     DotsHorizontal     横向三点，标准溢出菜单
 */
const NAV_ICON: Record<string, UntIcon> = {
  house: Home02,
  'messages-square': MessageCircle01,
  workflow: Dataflow02,
  group: Users03,
  ellipsis: DotsHorizontal,
  settings: Settings01,
  image: Image01,
  film: Film01,
  'panels-top-left': MessageCircle01,
}

export function NavGlyph({ name, className = '' }: { name: string; className?: string }) {
  const Glyph = NAV_ICON[name] ?? DotsHorizontal
  return <UiIcon icon={Glyph} size="lg" className={className} />
}

export function NavChevron({ className = '' }: { className?: string }) {
  return <UiIcon icon={ChevronRight} size="sm" className={`nav-chevron ${className}`.trim()} />
}
