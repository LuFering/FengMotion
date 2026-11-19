/**
 * 注入 LeiBox 输入框 Shadow DOM 的主题样式：三种主题适配与高度/圆角精修。
 *
 * <p>从 LeiBoxComposer 的挂载 effect 里原样搬出；showContextRing 为 false 时额外隐藏上下文圆圈。
 * 字符串内容（含缩进）与原先逐字一致。</p>
 */
export function composerThemeCss(showContextRing: boolean | undefined): string {
  return `
          /* ── 紧凑型外框与圆角恢复：由方形改回优雅流线型大圆角卡片，大幅压缩上下高度 ── */
          [data-message-composer-surface] {
            border-radius: var(--lbx-composer-radius, 20px) !important;
            transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease !important;
          }
          [data-message-composer-surface] > div {
            padding: 8px 12px 6px 12px !important;
          }

          /* ── 压缩输入区域最小高度：从 60px 缩为 36px ── */
          textarea.composer-textarea {
            min-height: 36px !important;
            height: 36px !important;
            line-height: 20px !important;
            font-size: 13px !important;
            padding: 0 !important;
          }
          /* 镜像高亮渲染层同步高度 */
          [data-message-composer-surface] [style*="min-height: 60px"],
          [data-message-composer-surface] [style*="minHeight: 60px"] {
            min-height: 36px !important;
            line-height: 20px !important;
            font-size: 13px !important;
          }

          /* ── 底部操作工具行（加号、权限、模型、发送）微调紧凑 ── */
          [data-message-composer-surface] .composer-footer,
          [data-message-composer-surface] .mt-2.flex.items-center,
          [data-message-composer-surface] div:has(> button[aria-label="发送消息"]),
          [data-message-composer-surface] div:has(> button[aria-label="Stop"]) {
            margin-top: 4px !important;
          }

          /* ── 主题模式 1：深色模式（dark） ── */
          [data-theme="dark"] [data-message-composer-surface] {
            background: #15161a !important;
            color: #ededed !important;
            border: 1px solid rgba(255, 255, 255, 0.09) !important;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.04) !important;
          }
          [data-theme="dark"] [data-message-composer-surface]:focus-within {
            border-color: rgba(59, 140, 248, 0.45) !important;
            box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(59, 140, 248, 0.25) !important;
          }
          [data-theme="dark"] textarea.composer-textarea {
            color: #ededed !important;
          }
          [data-theme="dark"] textarea.composer-textarea::placeholder,
          [data-theme="dark"] .composer-textarea--empty {
            color: #6e6e6e !important;
          }
          /* 占位文字高亮层深色适配 */
          [data-theme="dark"] .text-gray-400,
          [data-theme="dark"] span:has(+ textarea) {
            color: #6e6e6e !important;
          }
          /* 加号按钮深色 */
          [data-theme="dark"] button[aria-label*="添加"],
          [data-theme="dark"] button[aria-label*="Add"],
          [data-theme="dark"] .group\\/add {
            background: rgba(255, 255, 255, 0.06) !important;
            color: #9a9a9a !important;
          }
          [data-theme="dark"] button[aria-label*="添加"]:hover,
          [data-theme="dark"] button[aria-label*="Add"]:hover,
          [data-theme="dark"] .group\\/add:hover {
            background: rgba(255, 255, 255, 0.12) !important;
            color: #ededed !important;
          }
          /* 权限选择器按钮深色 */
          [data-theme="dark"] button:has(span.sr-only):not([aria-label*="添加"]):not([aria-label*="发送"]) {
            color: #9a9a9a !important;
          }
          [data-theme="dark"] button:has(span.sr-only):not([aria-label*="添加"]):not([aria-label*="发送"]):hover {
            color: #ededed !important;
          }
          /* 发送按钮深色禁用态 */
          [data-theme="dark"] button[aria-label="发送消息"]:disabled {
            background: rgba(255, 255, 255, 0.08) !important;
            color: rgba(255, 255, 255, 0.25) !important;
          }

          /* ── 主题模式 2：触感/纸感模式（tactile） ── */
          [data-theme="tactile"] [data-message-composer-surface] {
            background: #ddd8c9 !important;
            color: #22231f !important;
            border: 1px solid rgba(34, 35, 31, 0.18) !important;
            box-shadow: 0 2px 8px rgba(34, 35, 31, 0.08) !important;
          }
          [data-theme="tactile"] [data-message-composer-surface]:focus-within {
            border-color: rgba(217, 169, 43, 0.6) !important;
            box-shadow: 0 4px 12px rgba(34, 35, 31, 0.12) !important;
          }
          [data-theme="tactile"] textarea.composer-textarea {
            color: #22231f !important;
          }
          [data-theme="tactile"] textarea.composer-textarea::placeholder {
            color: #8a8676 !important;
          }
          [data-theme="tactile"] button[aria-label*="添加"],
          [data-theme="tactile"] button[aria-label*="Add"],
          [data-theme="tactile"] .group\\/add {
            background: rgba(34, 35, 31, 0.08) !important;
            color: #55534a !important;
          }

          /* ── 主题模式 3：浅色模式（light）保持默认设计不用改 ── */

          /* ── 弹出菜单（权限菜单与添加菜单）在所有主题下均有实色背景 ── */
          .morph-menu-content {
            background: var(--theme-elevated, #16171b) !important;
            color: var(--theme-fg, #ededed) !important;
            border: 1px solid var(--theme-border, rgba(255,255,255,0.1)) !important;
            border-radius: 14px !important;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45) !important;
          }
          [data-theme="tactile"] .morph-menu-content {
            background: #eae6da !important;
            color: #22231f !important;
            border: 1px solid rgba(34, 35, 31, 0.18) !important;
            box-shadow: 0 8px 24px rgba(34, 35, 31, 0.15) !important;
          }
          [data-theme="light"] .morph-menu-content {
            background: #ffffff !important;
            color: #1f2937 !important;
            border: 1px solid #e5e7eb !important;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1) !important;
          }

          ${showContextRing ? '' : '.composer-model-tools > div:has(button[aria-label^="Context"]) { display: none !important; }'}
        `
}

/**
 * 胶囊的环绕光与两级抽屉样式。
 *
 * 必须注入到官方组件的 Shadow DOM 里 —— 这些类名作用在它渲染出来的节点上，
 * 外部样式表穿不进去。光效沿用首页输入框那套（conic-gradient + mask xor
 * 裁成 2px 描边 + drop-shadow 发光），不用 box-shadow 是因为渐变要跑起来。
 */
export const PILL_CSS = `
/* External SVG images keep brand colors; monochrome Codex follows dark mode. */
[data-theme="dark"] img.fm-model-logo[src*="/openai.svg"] { filter:invert(1); }
@property --lbx-hz-spin { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
.lbx-hz-glow { position: relative; display: inline-flex; }
.lbx-hz-glow-ring {
  position: absolute; inset: -2px; border-radius: 999px; padding: 2px;
  pointer-events: none;
  background: conic-gradient(from var(--lbx-hz-spin),
    transparent 0deg, transparent 130deg,
    color-mix(in srgb, var(--lbx-engine-color, #4D6BFE) 45%, transparent) 200deg,
    var(--lbx-engine-color, #4D6BFE) 265deg,
    #fff 292deg,
    var(--lbx-engine-color, #4D6BFE) 315deg,
    color-mix(in srgb, var(--lbx-engine-color, #4D6BFE) 45%, transparent) 350deg,
    transparent 360deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--lbx-engine-color, #4D6BFE) 90%, transparent))
          drop-shadow(0 0 11px color-mix(in srgb, var(--lbx-engine-color, #4D6BFE) 60%, transparent));
  animation: lbx-hz-spin-cw 2.8s linear infinite;
}
@keyframes lbx-hz-spin-cw { to { --lbx-hz-spin: 360deg; } }
@media (prefers-reduced-motion: reduce) { .lbx-hz-glow-ring { animation: none; } }

/* One engine token colors the whole pill; the clockwise orbit is unchanged. */
.fm-model-trigger:not(.fm-model-square) {
  background:color-mix(in srgb,var(--lbx-engine-color) 5%,var(--theme-bg,#fff)) !important;
  border-color:color-mix(in srgb,var(--lbx-engine-color) 28%,var(--theme-border,#e5e7eb)) !important;
  box-shadow:0 0 8px color-mix(in srgb,var(--lbx-engine-color) 18%,transparent) !important;
}
.fm-model-trigger:focus-visible { outline-color:var(--lbx-engine-color) !important; }
/* 角度在主文档注册，光沿胶囊边缘顺时针绕行。 */
.fm-model-trigger::after {
  background: conic-gradient(from var(--lbx-model-angle), transparent 0deg, transparent 145deg, color-mix(in srgb,var(--lbx-engine-color) 45%,#fff) 235deg, var(--lbx-engine-color) 300deg, #fff 330deg, var(--lbx-engine-color) 348deg, transparent 360deg) !important;
  animation: lbx-model-flow 3.4s linear infinite !important;
}
@keyframes lbx-model-flow { from { --lbx-model-angle: 0deg; } to { --lbx-model-angle: 360deg; } }
@media (prefers-reduced-motion: reduce) { .fm-model-trigger::after { animation: none !important; } }

.lbx-hz-panel { overflow: hidden; padding: 6px 0; }
.lbx-hz-track { display: flex; width: 200%; transition: transform 320ms cubic-bezier(0.19, 1, 0.22, 1); }
.lbx-hz-panel[data-pane="model"] .lbx-hz-track { transform: translateX(-50%); }
.lbx-hz-page { width: 50%; flex-shrink: 0; padding: 0 10px; }
.lbx-hz-row {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 7px 8px; margin: 1px 0; border: 0; border-radius: 8px;
  background: transparent; color: inherit; font: inherit; font-size: 12.5px;
  text-align: left; cursor: pointer; transition: background-color 140ms ease;
}
.lbx-hz-row:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
.lbx-hz-row--on { background: color-mix(in srgb, var(--lbx-engine-color, #4D6BFE) 14%, transparent); }
.lbx-hz-back {
  display: inline-flex; align-items: center; gap: 3px;
  margin: 2px 0 4px; padding: 3px 6px; border: 0; border-radius: 6px;
  background: transparent; color: inherit; font: inherit; font-size: 11px;
  opacity: .65; cursor: pointer;
}
.lbx-hz-back:hover { opacity: 1; background: color-mix(in srgb, currentColor 7%, transparent); }
`
