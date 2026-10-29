import { useEffect, useState, type ReactNode } from 'react'
import { SidebarNav, SidebarFooter } from '@/shell/SidebarNav'
import { PendingAssetsButton, PendingAssetsDrawer } from '@/shell/PendingAssets'
import { LibraryDrawer } from '@/shell/LibraryDrawer'
import { deliverToComposer, usePendingAssets, type DeliverableAsset, type PendingFxCard, type PendingRefCard } from '@/shell/usePendingAssets'
import { onToast, toast as emitToast } from '@/shell/toast'
import type { ViewId } from '@/shell/views'

/**
 * 应用外壳 —— 侧栏 + 内容区。
 *
 * 结构对应 paba.tv 的 #app：
 *   #app
 *   ├── <aside class="hm-sidebar">   68px 图标轨（可展开 216px）
 *   └── 内容区（各 pane 由 App 按当前视图渲染）
 *
 * 为什么单独抽出来：
 *   01 期要保证「六个导航页共用一致壳」。壳的 DOM 一旦散在 App 里，
 *   每加一个视图就会再抄一遍侧栏。这里收成唯一一份。
 *
 * ⚠️ 顶部标签栏（paba 的 .tabbar）已删除 —— 它与侧栏是同一份导航，
 *    且运行时 `display: none`（死代码）。导航只有侧栏一处。
 * ⚠️ 本组件只管壳，不判断当前显示哪个 pane：视图分发仍留在 App，
 *    因为「目录 / 项目 / 工作台」共用同一个 ViewId，判断逻辑属于路由不属于壳。
 */
/** 参考片段拖拽时的参数包暂存键（与 RefLibrary 共用） */
const REF_STASH_KEY = 'fm-ref-card-stash-v1'
const FX_STASH_KEY = 'fm-fx-card-stash-v1'

/** 取出特效卡参数包（与参考片段同一套取回逻辑） */
function takeFxCards(ids: string[]): PendingFxCard[] {
  try {
    const raw = sessionStorage.getItem(FX_STASH_KEY)
    if (!raw) return []
    const map = JSON.parse(raw) as Record<string, PendingFxCard>
    const hit = ids.map((id) => map[id]).filter((c): c is PendingFxCard => !!c)
    if (hit.length > 0) {
      for (const c of hit) delete map[c.fxId]
      sessionStorage.setItem(FX_STASH_KEY, JSON.stringify(map))
    }
    return hit
  } catch {
    return []
  }
}

/**
 * 从暂存表里取出这些 ID 对应的参考参数包。
 * 为什么不在 DataTransfer 里直接传：它只能携带字符串，参数包（含六项分析+说明）
 * 塞进去既容易超限也难维护；只传 ID、落点再取回更稳。
 * 取到后从表里删掉，避免长期堆积。
 */
function takeRefCards(ids: string[]): PendingRefCard[] {
  try {
    const raw = sessionStorage.getItem(REF_STASH_KEY)
    if (!raw) return []
    const map = JSON.parse(raw) as Record<string, PendingRefCard>
    const hit = ids.map((id) => map[id]).filter((c): c is PendingRefCard => !!c)
    if (hit.length > 0) {
      for (const c of hit) delete map[c.segmentId]
      sessionStorage.setItem(REF_STASH_KEY, JSON.stringify(map))
    }
    return hit
  } catch {
    return []
  }
}

export function AppShell({
  view, onNavigate, wallpaper, onOpenSettings, onToggleNav,
  onDeliverPending, children,
}: {
  view: ViewId
  onNavigate: (id: ViewId) => void
  /** 壳层背景壁纸（设置 → 外观）；undefined = 不挂壁纸层 */
  wallpaper?: { id: string; src: string | null; dim: number } | null
  onOpenSettings: () => void
  onToggleNav: () => void
  /** 把待发送素材放进某个对话的输入框。返回 false = 当前没有可用的对话，
   *  此时清单原样保留（绝不假装发送成功、也不清空）。 */
  onDeliverPending?: (list: DeliverableAsset[]) => boolean
  children: ReactNode
}) {
  const pending = usePendingAssets()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [libOpen, setLibOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  /* 唯一的 toast 渲染点：任何视图 emitToast(...) 都落到这里 */
  useEffect(() => onToast((text) => {
    setToast(text)
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 2400)
  }), [])

  return (
    <div id="app">
      {/* 壁纸层：贴在 z-index 0，壳层内容（含监看器画面）都在它之上，
          所以「播放器画面不受壁纸影响」是结构上成立的，不靠额外规则去修。
          只在当前视图命中显示范围时才挂载 —— 不命中就把这一层整个拿掉。 */}
      {wallpaper && (
        <div className="fm-wall" aria-hidden="true"
             data-wall={wallpaper.id}
             style={{
               '--wall-dim': String(wallpaper.dim / 100),
               ...(wallpaper.src ? { backgroundImage: `url(${wallpaper.src})` } : null),
             } as React.CSSProperties} />
      )}
      <aside className="hm-sidebar" id="hm-sidebar" aria-label="主导航">
        <div className="hm-sidebar-head">
          {/* logo 现在就是「隐藏导航栏」的开关：点一下整条侧栏让出空间。
              图标与字标仍整体是一个 <a>，但点它不再跳转 —— 跳转和收起
              是两种意图，混在一个元素上容易误触。 */}
          <button type="button" className="hm-brand hm-brand-toggle"
                  aria-label="隐藏导航栏" title="隐藏导航栏"
                  onClick={onToggleNav}>
            <span className="hm-brand-mark">
              <img src="./assets/brand/fengmotion-mark.png" alt="" width={26} height={26} />
            </span>
            <span className="hm-brand-word app-brand-logo">
              <img src="./assets/brand/fengmotion-word.png" alt="FengMotion" style={{ height: 14, width: 'auto' }} />
            </span>
            <svg className="ui-icon hm-brand-hide" aria-hidden="true"><use href="./assets/paba-icons.svg#panel-left-close" /></svg>
          </button>
        </div>

        <SidebarNav current={view} onNavigate={onNavigate} onOpenLibrary={() => setLibOpen(true)} />

        <SidebarFooter onOpenSettings={onOpenSettings}
                      pendingSlot={
                        <PendingAssetsButton
                          onOpen={() => setDrawerOpen(true)}
                          onAdd={(ids) => {
                            /* 拖进来的是两样东西：素材 ID、参考片段 ID。
                               两者都存在同一个「待发送」里，但入列逻辑不同 ——
                               素材要去素材库查，参考的参数随条目自带。
                               所以先按暂存表把参考片段认出来，剩下的当素材。 */
                            const refCards = takeRefCards(ids)
                            const fxCards = takeFxCards(ids)
                            const special = new Set([
                              ...refCards.map((c) => c.segmentId),
                              ...fxCards.map((c) => c.fxId),
                            ])
                            const assetIds = ids.filter((id) => !special.has(id))
                            const nRef = refCards.length > 0 ? pending.addRef(refCards) : 0
                            const nFx = fxCards.length > 0 ? pending.addFx(fxCards) : 0
                            const nAsset = assetIds.length > 0 ? pending.add(assetIds) : 0
                            return nRef + nFx + nAsset
                          }}
                          toast={emitToast} />
                      } />
      </aside>

      {children}

      {/* 侧栏隐藏后的恢复入口：贴在左上角，随内容一起淡入。
          没有它就只能刷新页面才能找回导航。 */}
      <button type="button" className="hm-sidebar-restore" aria-label="显示导航栏" title="显示导航栏"
              onClick={onToggleNav}>
        <svg className="ui-icon" aria-hidden="true"><use href="./assets/paba-icons.svg#panel-left-open" /></svg>
      </button>

      <LibraryDrawer
        open={libOpen}
        current={view}
        onClose={() => setLibOpen(false)}
        onPick={(id) => { setLibOpen(false); onNavigate(id) }}
      />

      <PendingAssetsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSend={(list) => {
          /* 优先用外部注入的投递器（工作台对话），否则落到全局注册的当前输入框 */
          const ok = onDeliverPending ? onDeliverPending(list) : deliverToComposer(list)
          if (!ok) emitToast('当前没有打开的对话，先进入「我的创作」再添加')
          return ok
        }} />

      {toast && <div className="fm-toast" role="status">{toast}</div>}
    </div>
  )
}
