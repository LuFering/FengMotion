/**
 * 素材拖拽的「拖影」—— 把浏览器默认那张半透明大截图，换成一小块缩略图。
 *
 * 为什么必须自定义：默认拖影是元素自身的快照，素材卡在网格里是 292×330，
 * 拖起来像举着一张桌布，鼠标附近全被盖住，看不清落点。缩到 56px 左右
 * （比鼠标指针大一圈）既认得出是哪个素材，又不挡视线。
 *
 * 多选时拖影右下角带一个「×N」角标 —— 用户选 4 个再拖，得知道拖的是 4 个。
 *
 * 实现约束：setDragImage 需要一个**已经在文档里、且可见**的元素。
 * 元素必须在 dragstart 同步返回前完成布局，所以这里用同步创建 + 强制 reflow，
 * 拖拽结束后再移除。用 requestAnimationFrame 延后移除会失败（浏览器已经截图）。
 */
let ghost: HTMLDivElement | null = null

function ensureGhost(): HTMLDivElement {
  if (ghost && ghost.isConnected) return ghost
  const el = document.createElement('div')
  el.className = 'fm-drag-ghost'
  el.setAttribute('aria-hidden', 'true')
  document.body.appendChild(el)
  ghost = el
  return el
}

export function setDragGhost(opts: {
  /** 缩略图地址；没有就落回文字首字 */
  thumb?: string | null
  label: string
  count: number
}) {
  const el = ensureGhost()
  el.innerHTML = ''
  el.dataset.multi = opts.count > 1 ? 'true' : 'false'

  if (opts.thumb) {
    const img = document.createElement('img')
    img.src = opts.thumb
    img.alt = ''
    el.appendChild(img)
  } else {
    const ph = document.createElement('span')
    ph.className = 'fm-drag-ghost-ph'
    ph.textContent = (opts.label.trim()[0] ?? '素').toUpperCase()
    el.appendChild(ph)
  }

  if (opts.count > 1) {
    const badge = document.createElement('span')
    badge.className = 'fm-drag-ghost-n'
    badge.textContent = `×${opts.count}`
    el.appendChild(badge)
  }
  return el
}

/** dragend / drop 之后清掉，别在 DOM 里留垃圾 */
export function clearDragGhost() {
  if (ghost) {
    ghost.remove()
    ghost = null
  }
}
