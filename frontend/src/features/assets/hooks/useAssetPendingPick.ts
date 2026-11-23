import type * as React from 'react'
import { usePendingAssets } from '@/features/assets/hooks/usePendingAssets'
import { toast as emitToast } from '@/shared/lib/toast'
import { assetUseBlock } from '../model/assetDisplay'
import type { MyAsset } from '../model/myAssets'
import { useState } from 'react'

export interface UseAssetPendingPickArgs {
  assets: MyAsset[]
  selected: Set<string>
  setDetailId: React.Dispatch<React.SetStateAction<string | null>>
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
}

/** 我的素材与待发送清单的衔接：把素材加入待发送，以及「选择素材」模式的进入、确认与退出。 */
export function useAssetPendingPick({ assets, selected, setDetailId, setSelected }: UseAssetPendingPickArgs) {
  /* 待发送：素材库是「挑素材」的地方，这里只负责把选中项交给那份全局清单。
     加入 ≠ 发送，也不改素材本身的任何字段。 */
  const pending = usePendingAssets()
  const addToPending = (ids: string[]) => {
    const eligible = ids.filter(id => {
      const asset = assets.find(a => a.id === id)
      return asset && !assetUseBlock(asset)
    })
    const existing = new Set(pending.items.map(item => item.assetId))
    const candidates = eligible.filter(id => !existing.has(id))
    const n = pending.add(eligible)
    const addedIds = new Set([...existing, ...candidates.slice(0, n)])
    setSelected(current => new Set([...current].filter(id => !addedIds.has(id))))
    const blocked = ids.length - eligible.length
    const overflow = candidates.length - n
    const notes = [n ? `已加入待发送 ${n} 项` : '', blocked ? `${blocked} 项暂不可用` : '', overflow ? `待发送最多 24 项，${overflow} 项未加入` : ''].filter(Boolean)
    emitToast(notes.join('；') || '所选素材已在待发送中')
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
    const ids = [...selected]
    const missing = ids.filter(id => !pending.has(id))
    const n = addToPending(ids)
    if (n === missing.length) setPickMode(false)
    // 不可用或容量限制导致的剩余项继续保留，供用户调整。
  }
  return { setPickMode, enterPick, pickMode, addToPending, pending, exitPick, confirmPick }
}
