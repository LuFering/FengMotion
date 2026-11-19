import { Icon } from '@/features/reference/components/RefIcon'

export interface RefCatalogErrorProps {
  catalogError: string
}

/** 从 RefLibrary.tsx 原样拆出的界面区块；props 与原处的变量同名。 */
export function RefCatalogError({ catalogError }: RefCatalogErrorProps) {
  return (
    <div className="rfc rfc-empty-state">
      <div className="rfc-empty-card">
        <div className="rfc-empty-icon" aria-hidden="true"><Icon name="film" /></div>
        <h2 className="rfc-empty-title">参考片库读取失败</h2>
        <p className="rfc-empty-desc">{catalogError}</p>
        <button type="button" className="rfc-empty-btn" onClick={() => window.location.reload()}>
          重试
        </button>
      </div>
    </div>
  )
}
