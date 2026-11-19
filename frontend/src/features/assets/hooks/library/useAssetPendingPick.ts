import type * as React from 'react'
import { usePendingAssets } from '@/features/assets/hooks/usePendingAssets'
import { toast as emitToast } from '@/shared/lib/toast'
import { useState } from 'react'

export interface UseAssetPendingPickArgs {
  selected: Set<string>
  setDetailId: React.Dispatch<React.SetStateAction<string | null>>
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
}

/** 从 Assets.tsx 的 Assets 原样搬出的一段状态与逻辑；参数与返回值和原处的变量同名。 */
export function useAssetPendingPick({ selected, setDetailId, setSelected }: UseAssetPendingPickArgs) {
  /* 待发送：素材库是「挑素材」的地方，这里只负责把选中项交给那份全局清单。
     加入 ≠ 发送，也不改素材本身的任何字段。 */
  const pending = usePendingAssets()
  const addToPending = (ids: string[]) => {
    const n = pending.add(ids)
    emitToast(n > 0 ? `已添加 ${n} 个素材` : '已在待发送中')
    return n
  }
  /* 「选择素材」模式 —— 作者要的是一个实在的按钮：点下去整库进入可选中状态，
     选完点确认一键进购物车。
     和原来那套「先勾复选框、再在批量栏里找操作」的差别：
       · 进入模式前复选框是**隐藏的**（要 hover 才出现），没人知道能多选；
       · 进入后每张卡都有明确的选中框和选中态，目标只有一个：挑素材。
     退出方式三种：确认、取消、Esc。 */
  const [pickMode, setPickMode] = useState(false)
  const enterPick = () => { setPickMode(true); setSelected(new Set()); setDetailId(null) }
  const exitPick = () => { setPickMode(false); setSelected(new Set()) }
  const confirmPick = () => {
    if (selected.size === 0) { exitPick(); return }
    addToPending([...selected])
    exitPick()
  }
  return { setPickMode, enterPick, pickMode, addToPending, pending, exitPick, confirmPick }
}
