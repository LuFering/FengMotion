/**
 * 多选模式 —— 素材库 / 参考片库 / 特效库共用。
 *
 * 为什么抽出来：三个库的「挑一批东西加进待发送」是同一个动作，
 * 之前只有素材库有，另外两个只能一个一个点「＋」。抽成一份后：
 *   · 三处行为完全一致（进入/退出/全选/确认/撤销），不会各自漂移；
 *   · 样式也只有一份，改一处三处生效。
 *
 * 交互设计（继承素材库的定稿）：
 *   · 进入前卡片上是**没有**复选框的——"能多选"这件事对用户不可见；
 *   · 进入后每张卡常驻一个选中框，整块可点，目标只有一个：挑。
 *   · 底部浮一条确认条，只做三件事：报数、全选、确认。
 *   · 出口有三个：确认、取消、Esc。
 */
import { useCallback, useEffect, useState } from 'react'

export interface PickMode {
  active: boolean
  selected: Set<string>
  /** 某一条是否已选中 */
  has: (id: string) => boolean
  /** 进入：清空上次的选择 */
  enter: () => void
  /** 退出：不确认任何东西 */
  exit: () => void
  /** 切换某一条的选中态 */
  toggle: (id: string) => void
  /** 全选传入的这一批 */
  selectAll: (ids: string[]) => void
  /** 确认后调用 onConfirm，然后退出。没选任何东西时直接退出，不弹提示。 */
  confirm: (onConfirm: (ids: string[]) => void) => void
}

export function usePickMode(): PickMode {
  const [active, setActive] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const enter = useCallback(() => {
    setSelected(new Set())
    setActive(true)
  }, [])

  const exit = useCallback(() => {
    setActive(false)
    setSelected(new Set())
  }, [])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback((ids: string[]) => setSelected(new Set(ids)), [])

  const confirm = useCallback((onConfirm: (ids: string[]) => void) => {
    setSelected((prev) => {
      if (prev.size > 0) onConfirm([...prev])
      return new Set()
    })
    setActive(false)
  }, [])

  /* Esc 退出 —— 否则进了模式只能去找那个按钮才能出来 */
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, exit])

  return {
    active,
    selected,
    has: (id) => selected.has(id),
    enter,
    exit,
    toggle,
    selectAll,
    confirm,
  }
}
