/* Bridge for bundled, provenance-tracked local scene sources only. No remote HTML import. */
;(() => {
  if (window.__fengEditorBridge) return
  window.__fengEditorBridge = true
  const timeline = Object.values(window.__timelines || {})[0]
  if (!timeline) {
    parent.postMessage(
      { channel: 'feng-editor', type: 'error', message: '源场景没有可控制的动画时间轴。' },
      '*',
    )
    return
  }
  timeline.pause()
  const root = document.querySelector('[data-composition-id]') || document.getElementById('root')
  const duration = Number(root?.dataset.duration) || timeline.duration()
  const candidates = Array.from(document.body.querySelectorAll('[id],img,h1,h2,h3,p'))
    .filter(
      (el) =>
        !['SCRIPT', 'STYLE', 'CANVAS'].includes(el.tagName) && el !== root && el.id !== 'feng-selection',
    )
    .slice(0, 200)
  const seen = new Set()
  const nodes = candidates.filter((el) => {
    if (seen.has(el)) return false
    seen.add(el)
    return true
  })
  const original = new Map()
  const lookup = new Map()
  const rgbHex = (value) => {
    const nums = value.match(/[\d.]+/g)
    return nums?.length >= 3
      ? '#' +
          nums
            .slice(0, 3)
            .map((n) => Math.round(Number(n)).toString(16).padStart(2, '0'))
            .join('')
      : '#ffffff'
  }
  nodes.forEach((el, i) => {
    const key = el.id ? `#${el.id}` : `element-${i}`
    el.dataset.fengElement = key
    lookup.set(key, el)
    original.set(key, {
      style: el.getAttribute('style'),
      text: el.children.length === 0 ? el.textContent : null,
      src: el.getAttribute('src'),
    })
  })
  timeline.seek(Math.min(2, duration * 0.6), false)
  const info = nodes.map((el) => {
    const rect = el.getBoundingClientRect(),
      style = getComputedStyle(el)
    const key = el.dataset.fengElement
    const text = el.children.length === 0 ? (el.textContent || '').trim() : ''
    return {
      id: key,
      name: text.slice(0, 28) || el.getAttribute('alt') || el.id || el.tagName.toLowerCase(),
      kind: el.tagName === 'IMG' ? 'image' : text ? 'text' : 'group',
      text: text || undefined,
      src: el.tagName === 'IMG' ? el.src : undefined,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      fontSize: parseFloat(style.fontSize) || 16,
      color: rgbHex(style.color),
      gradientText: style.backgroundImage.includes("gradient") && (style.backgroundClip === "text" || style.webkitBackgroundClip === "text"),
      opacity: parseFloat(style.opacity),
    }
  })
  const selection = document.createElement('div')
  selection.id = 'feng-selection'
  Object.assign(selection.style, {
    position: 'fixed',
    pointerEvents: 'none',
    border: '3px solid #3b8cf8',
    zIndex: '2147483647',
    display: 'none',
    boxSizing: 'border-box',
  })
  document.body.append(selection)
  const originals = () =>
    original.forEach((value, key) => {
      const el = lookup.get(key)
      if (value.style === null) el.removeAttribute('style')
      else el.setAttribute('style', value.style)
      if (value.text !== null) el.textContent = value.text
      if (value.src !== null) el.setAttribute('src', value.src)
    })
  function update(data) {
    originals()
    timeline.pause()
    timeline.seek(0, false)
    timeline.seek(
      Math.min(
        duration,
        (Math.max(0, Number(data.time) || 0) * duration) / (Number(data.duration) || duration),
      ),
      false,
    )
    Object.entries(data.patches || {}).forEach(([id, p]) => {
      const el = lookup.get(id)
      if (!el) return
      if (p.text !== undefined && original.get(id).text !== null) el.textContent = String(p.text)
      if (p.src !== undefined && el.tagName === 'IMG') el.src = p.src
      if (p.x !== undefined || p.y !== undefined) el.style.translate = `${p.x || 0}px ${p.y || 0}px`
      if (p.scale !== undefined) el.style.scale = String(p.scale)
      if (p.rotation !== undefined) el.style.rotate = `${p.rotation}deg`
      if (p.opacity !== undefined) el.style.opacity = String(Number(getComputedStyle(el).opacity) * p.opacity)
      if (p.visible === false) el.style.visibility = 'hidden'
      if (p.fontSize !== undefined) el.style.fontSize = `${p.fontSize}px`
      if (p.color !== undefined) {
        el.style.color = p.color
        el.style.webkitTextFillColor = p.color
        el.style.backgroundImage = 'none'
      }
      if (p.backgroundColor !== undefined) el.style.backgroundColor = p.backgroundColor
      if (p.width !== undefined) el.style.width = `${p.width}px`
      if (p.height !== undefined) el.style.height = `${p.height}px`
      if (p.radius !== undefined) el.style.borderRadius = `${p.radius}px`
    })
    const target = lookup.get(data.selected)
    if (target) {
      const r = target.getBoundingClientRect()
      Object.assign(selection.style, {
        display: 'block',
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      })
    } else selection.style.display = 'none'
  }
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.channel !== 'feng-editor' || event.data.type !== 'update')
      return
    update(event.data)
  })
  document.addEventListener(
    'click',
    (event) => {
      let el = event.target
      while (el && el !== document.body && !el.dataset.fengElement) el = el.parentElement
      if (el?.dataset.fengElement) {
        event.preventDefault()
        event.stopPropagation()
        parent.postMessage({ channel: 'feng-editor', type: 'select', id: el.dataset.fengElement }, '*')
      }
    },
    true,
  )
  timeline.seek(0, false)
  parent.postMessage({ channel: 'feng-editor', type: 'ready', elements: info, duration }, '*')
})()
