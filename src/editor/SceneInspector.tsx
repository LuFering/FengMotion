import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Lock, Trash2, Unlock } from 'lucide-react'
import type { EditorLayer, ElementPatch, HtmlElementInfo, SceneDocument } from './types'
function NumberField({
  label,
  value,
  onChange,
  min = -8192,
  max = 8192,
  step = 1,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="se-field">
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
      />
    </label>
  )
}
function Group({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="se-property-group" open={open}>
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  )
}
export function SceneInspector({
  document,
  layer,
  element,
  selected,
  onDocument,
  onLayer,
  onPatch,
  onChooseAsset,
  onDelete,
  onDuplicate,
  onReorder,
}: {
  document: SceneDocument
  layer?: EditorLayer
  element?: HtmlElementInfo
  selected: string | null
  onDocument: (patch: Partial<SceneDocument>) => void
  onLayer: (patch: Partial<EditorLayer>) => void
  onPatch: (patch: ElementPatch) => void
  onChooseAsset: () => void
  onDelete: () => void
  onDuplicate: () => void
  onReorder: (direction: number) => void
}) {
  const patch = selected ? (document.patches[selected] ?? {}) : {}
  const native = document.engine === 'remotion'
  return (
    <div className="se-inspector-content">
      <header className="se-inspector-title">
        <span>{layer ? '图层属性' : element ? '源元素属性' : '场景设置'}</span>
        <strong>{layer?.name ?? element?.name ?? document.name}</strong>
      </header>
      {native && layer ? (
        <>
          <div className="se-layer-actions">
            <button
              type="button"
              title={layer.visible ? '隐藏图层' : '显示图层'}
              aria-label={layer.visible ? '隐藏图层' : '显示图层'}
              onClick={() => onLayer({ visible: !layer.visible })}
            >
              {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button
              type="button"
              title="切换图层锁定"
              aria-label="切换图层锁定"
              onClick={() => onLayer({ locked: !layer.locked })}
            >
              {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
            <button type="button" title="复制图层" aria-label="复制图层" onClick={onDuplicate}>
              <Copy size={14} />
            </button>
            <button type="button" title="图层上移" aria-label="图层上移" onClick={() => onReorder(1)}>
              <ArrowUp size={14} />
            </button>
            <button type="button" title="图层下移" aria-label="图层下移" onClick={() => onReorder(-1)}>
              <ArrowDown size={14} />
            </button>
            <button type="button" title="删除图层（可撤销）" aria-label="删除图层" onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          </div>
          <fieldset disabled={layer.locked}>
            <label className="se-field">
              <span>图层名称</span>
              <input
                aria-label="图层名称"
                value={layer.name}
                onChange={(e) => onLayer({ name: e.target.value })}
              />
            </label>
            {layer.kind === 'text' && (
              <Group title="文字">
                <label className="se-field">
                  <span>文字内容</span>
                  <textarea
                    aria-label="文字内容"
                    rows={3}
                    maxLength={8000}
                    value={layer.text}
                    onChange={(e) => onLayer({ text: e.target.value })}
                  />
                </label>
                <div className="se-field-row">
                  <NumberField
                    label="字号"
                    value={layer.fontSize}
                    min={8}
                    max={500}
                    onChange={(fontSize) => onLayer({ fontSize })}
                  />
                  <NumberField
                    label="字重"
                    value={layer.fontWeight}
                    min={100}
                    max={900}
                    step={100}
                    onChange={(fontWeight) => onLayer({ fontWeight })}
                  />
                </div>
                <div className="se-field-row">
                  <label className="se-field">
                    <span>文字颜色</span>
                    <input
                      aria-label="文字颜色"
                      type="color"
                      value={layer.color}
                      onChange={(e) => onLayer({ color: e.target.value })}
                    />
                  </label>
                  <label className="se-field">
                    <span>文字对齐</span>
                    <select
                      aria-label="文字对齐"
                      value={layer.align}
                      onChange={(e) => onLayer({ align: e.target.value as EditorLayer['align'] })}
                    >
                      <option value="left">左对齐</option>
                      <option value="center">居中</option>
                      <option value="right">右对齐</option>
                    </select>
                  </label>
                </div>
              </Group>
            )}
            {['image', 'video', 'audio'].includes(layer.kind) && (
              <Group title="素材">
                <button type="button" className="se-action" onClick={onChooseAsset}>
                  {layer.assetId || layer.src ? '替换素材' : '选择素材'}
                </button>
                <p className="se-caption">
                  {layer.assetId
                    ? '已绑定素材库文件，刷新后可恢复'
                    : layer.src
                      ? '已绑定文件路径'
                      : '此图层尚未绑定文件'}
                </p>
                {layer.kind !== 'audio' && (
                  <label className="se-field">
                    <span>填充方式</span>
                    <select
                      aria-label="素材填充方式"
                      value={layer.fit}
                      onChange={(e) => onLayer({ fit: e.target.value as EditorLayer['fit'] })}
                    >
                      <option value="contain">完整显示</option>
                      <option value="cover">填满裁切</option>
                    </select>
                  </label>
                )}
                {layer.kind !== 'image' && (
                  <>
                    <NumberField
                      label="素材起点（秒）"
                      min={0}
                      max={36000}
                      step={0.1}
                      value={layer.trimStart}
                      onChange={(trimStart) => onLayer({ trimStart })}
                    />
                    <NumberField
                      label="音量"
                      min={0}
                      max={2}
                      step={0.05}
                      value={layer.volume}
                      onChange={(volume) => onLayer({ volume })}
                    />
                  </>
                )}
              </Group>
            )}
            {layer.kind !== 'audio' && (
              <Group title="布局与外观">
                <div className="se-field-row">
                  <NumberField label="X 位置" value={layer.x} onChange={(x) => onLayer({ x })} />
                  <NumberField label="Y 位置" value={layer.y} onChange={(y) => onLayer({ y })} />
                </div>
                <div className="se-field-row">
                  <NumberField
                    label="宽度"
                    min={1}
                    value={layer.width}
                    onChange={(width) => onLayer({ width })}
                  />
                  <NumberField
                    label="高度"
                    min={1}
                    value={layer.height}
                    onChange={(height) => onLayer({ height })}
                  />
                </div>
                <div className="se-field-row">
                  <NumberField
                    label="旋转角度"
                    min={-360}
                    max={360}
                    value={layer.rotation}
                    onChange={(rotation) => onLayer({ rotation })}
                  />
                  <NumberField
                    label="不透明度"
                    min={0}
                    max={1}
                    step={0.05}
                    value={layer.opacity}
                    onChange={(opacity) => onLayer({ opacity })}
                  />
                </div>
                <NumberField
                  label="圆角"
                  min={0}
                  max={1000}
                  value={layer.radius}
                  onChange={(radius) => onLayer({ radius })}
                />
                {layer.kind === 'shape' && (
                  <label className="se-field">
                    <span>填充颜色</span>
                    <input
                      aria-label="填充颜色"
                      type="color"
                      value={layer.fill}
                      onChange={(e) => onLayer({ fill: e.target.value })}
                    />
                  </label>
                )}
              </Group>
            )}
            <Group title="时间与动画">
              <div className="se-field-row">
                <NumberField
                  label="入点（秒）"
                  min={0}
                  max={layer.end - 0.01}
                  step={0.1}
                  value={layer.start}
                  onChange={(start) => onLayer({ start })}
                />
                <NumberField
                  label="出点（秒）"
                  min={layer.start + 0.01}
                  max={document.durationSeconds}
                  step={0.1}
                  value={layer.end}
                  onChange={(end) => onLayer({ end })}
                />
              </div>
              {layer.kind !== 'audio' && (
                <>
                  <label className="se-field">
                    <span>入场方式</span>
                    <select
                      aria-label="入场方式"
                      value={layer.motion}
                      onChange={(e) => onLayer({ motion: e.target.value as EditorLayer['motion'] })}
                    >
                      <option value="none">无入退场动画</option>
                      <option value="rise">上浮进入</option>
                      <option value="scale">缩放进入</option>
                    </select>
                  </label>
                  {layer.motion !== 'none' && (
                    <>
                      <div className="se-field-row">
                        <NumberField
                          label="入场时长（秒）"
                          min={0.05}
                          max={10}
                          step={0.05}
                          value={layer.entrance}
                          onChange={(entrance) => onLayer({ entrance })}
                        />
                        <NumberField
                          label="退场时长（秒）"
                          min={0}
                          max={10}
                          step={0.05}
                          value={layer.exit}
                          onChange={(exit) => onLayer({ exit })}
                        />
                      </div>
                      <NumberField
                        label="位移幅度"
                        min={0}
                        max={500}
                        value={layer.travel}
                        onChange={(travel) => onLayer({ travel })}
                      />
                    </>
                  )}
                  {layer.kind === 'image' && (
                    <NumberField
                      label="画面缓推倍率"
                      min={1}
                      max={2}
                      step={0.01}
                      value={layer.zoom}
                      onChange={(zoom) => onLayer({ zoom })}
                    />
                  )}
                </>
              )}
            </Group>
          </fieldset>
        </>
      ) : !native && element ? (
        <>
          <p className="se-caption">
            直接编辑源工程的 {element.id}。原有 GSAP 动画保留，位移与旋转作为增量叠加。
          </p>
          {element.kind === 'text' && (
            <Group title="文字">
              <label className="se-field">
                <span>源文字</span>
                <textarea
                  aria-label="源文字"
                  value={patch.text ?? element.text ?? ''}
                  rows={3}
                  onChange={(e) => onPatch({ text: e.target.value })}
                />
              </label>
              <div className="se-field-row">
                <NumberField
                  label="源字号"
                  min={8}
                  max={1000}
                  value={patch.fontSize ?? element.fontSize}
                  onChange={(fontSize) => onPatch({ fontSize })}
                />
                <label className="se-field">
                  <span>{element.gradientText ? '纯色覆盖' : '源文字颜色'}</span>
                  <input
                    type="color"
                    aria-label="源文字颜色"
                    value={patch.color ?? element.color}
                    onChange={(e) => onPatch({ color: e.target.value })}
                  />
                </label>
              </div>
            </Group>
          )}
          {element.gradientText && !patch.color && (
            <p className="se-caption">原文字使用渐变填充。选择颜色后将覆盖为纯色，可恢复原貌。</p>
          )}
          {element.kind === 'image' && (
            <Group title="图片素材">
              <button type="button" className="se-action" onClick={onChooseAsset}>
                替换源图片
              </button>
              <p className="se-caption">使用素材库真实文件，保留原场景图片动画。</p>
            </Group>
          )}
          <Group title="位置与外观">
            <div className="se-field-row">
              <NumberField label="水平偏移" value={patch.x ?? 0} onChange={(x) => onPatch({ x })} />
              <NumberField label="垂直偏移" value={patch.y ?? 0} onChange={(y) => onPatch({ y })} />
            </div>
            <div className="se-field-row">
              <NumberField
                label="缩放倍率"
                min={0.1}
                max={5}
                step={0.05}
                value={patch.scale ?? 1}
                onChange={(scale) => onPatch({ scale })}
              />
              <NumberField
                label="旋转角度"
                min={-360}
                max={360}
                value={patch.rotation ?? 0}
                onChange={(rotation) => onPatch({ rotation })}
              />
            </div>
            <NumberField
              label="不透明度倍率"
              min={0}
              max={1}
              step={0.05}
              value={patch.opacity ?? 1}
              onChange={(opacity) => onPatch({ opacity })}
            />
            <label className="se-check">
              <input
                type="checkbox"
                checked={patch.visible !== false}
                onChange={(e) => onPatch({ visible: e.target.checked })}
              />
              显示此元素
            </label>
            <button
              type="button"
              className="se-action"
              onClick={() =>
                onDocument({
                  patches: Object.fromEntries(
                    Object.entries(document.patches).filter(([id]) => id !== selected),
                  ),
                })
              }
            >
              恢复此元素原貌
            </button>
          </Group>
        </>
      ) : (
        <>
          <Group title="场景规格">
            <label className="se-field">
              <span>场景名称</span>
              <input
                aria-label="场景名称"
                value={document.name}
                onChange={(e) => onDocument({ name: e.target.value })}
              />
            </label>
            <NumberField
              label="场景时长（秒）"
              value={document.durationSeconds}
              min={0.5}
              max={600}
              step={0.1}
              onChange={(durationSeconds) =>
                onDocument({
                  durationSeconds,
                  layers: document.layers.map((l) => ({
                    ...l,
                    start: Math.min(l.start, durationSeconds - 0.01),
                    end: Math.min(l.end, durationSeconds),
                  })),
                })
              }
            />
            {native ? (
              <>
                <div className="se-field-row">
                  <NumberField
                    label="画布宽度"
                    value={document.width}
                    min={64}
                    max={4096}
                    step={2}
                    onChange={(width) => onDocument({ width: Math.round(width / 2) * 2 })}
                  />
                  <NumberField
                    label="画布高度"
                    value={document.height}
                    min={64}
                    max={4096}
                    step={2}
                    onChange={(height) => onDocument({ height: Math.round(height / 2) * 2 })}
                  />
                </div>
                <label className="se-field">
                  <span>帧率</span>
                  <select
                    aria-label="帧率"
                    value={document.fps}
                    onChange={(e) => onDocument({ fps: Number(e.target.value) })}
                  >
                    {[24, 25, 30, 60].map((v) => (
                      <option key={v} value={v}>
                        {v} fps
                      </option>
                    ))}
                  </select>
                </label>
                <label className="se-field">
                  <span>背景颜色</span>
                  <input
                    aria-label="背景颜色"
                    type="color"
                    value={document.background}
                    onChange={(e) => onDocument({ background: e.target.value })}
                  />
                </label>
              </>
            ) : (
              <p className="se-caption">
                {document.width} × {document.height} · {document.fps} fps
                <br />
                尺寸沿用源工程。时长调整会按比例重映射原动画时间轴。
              </p>
            )}
          </Group>
          {!native && (
            <Group title="真实来源">
              <p className="se-caption">{document.source?.source}</p>
              <code className="se-source-hash">SHA-256 {document.source?.sourceHash.slice(0, 16)}…</code>
              <p className="se-caption">本机导入的源工程副本。修改保存为覆盖记录，原始文件保持不变。</p>
            </Group>
          )}
        </>
      )}
    </div>
  )
}
