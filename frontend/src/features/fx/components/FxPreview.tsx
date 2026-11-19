import { Component, lazy, type ReactNode } from 'react'

export const FxOriginalWavesPreview = lazy(() => import('@/features/fx/components/FxOriginalWavesPreview'))

export class FxPreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <span className="fxc-media-empty">原始画面加载失败</span> : this.props.children }
}
