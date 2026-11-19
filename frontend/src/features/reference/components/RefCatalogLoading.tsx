

/** 参考片库首次加载期间的整页等待状态。 */
export function RefCatalogLoading() {
  return (
    <div className="rfc rfc-empty-state">
      <div className="rfc-empty-card">
        <div className="rfc-empty-spinner" aria-hidden="true" />
        <h2 className="rfc-empty-title">正在读取参考片库</h2>
        <p className="rfc-empty-desc">从本地服务加载视频与片段…</p>
      </div>
    </div>
  )
}
