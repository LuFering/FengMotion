/**
 * 源码分析与写回：按 `文件:行:列` 找到 JSX 元素，读出它「写死的」属性，或只替换其中一个值。
 *
 * 只改字面量（字符串 / 数字 / 布尔）、style 对象里的字面量、元素里的纯文字；
 * 计算出来的值（变量、表达式、模板串插值）只报告代码，不改 —— 除非调用方明确要求
 * 「把这个表达式换成固定值」（例如颜色 C.ink → '#F4EEE4'），且带上原表达式做核对。
 *
 * 改动用文本替换完成（不重新打印整份文件），缩进、注释、引号风格都保持原样。
 * 纯函数：输入源码字符串，输出新源码字符串；读写文件、撤销栈由 server.mjs 负责。
 */

/** @typedef {{ kind: 'string' | 'number' | 'boolean', value: string | number | boolean, quote?: string }
 *   | { kind: 'expr', code: string }
 *   | { kind: 'object', props: Record<string, Descr>, code: string }} Descr */

const SKIP = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'range'])

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return false
  if (visit(node)) return true
  for (const key of Object.keys(node)) {
    if (SKIP.has(key)) continue
    const child = node[key]
    if (Array.isArray(child)) { for (const c of child) if (c && typeof c.type === 'string' && walk(c, visit)) return true }
    else if (child && typeof child.type === 'string' && walk(child, visit)) return true
  }
  return false
}

export function parse(parser, code) {
  return parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'], errorRecovery: false })
}

/** 找到 `行:列`（列从 1 起）开始的 JSX 元素 */
export function findElement(ast, line, column) {
  let found = null
  walk(ast.program, (node) => {
    if (node.type === 'JSXElement' && node.openingElement.loc.start.line === line && node.openingElement.loc.start.column + 1 === column) {
      found = node
      return true
    }
    return false
  })
  return found
}

function keyName(prop) {
  if (prop.type !== 'ObjectProperty' || prop.computed) return null
  if (prop.key.type === 'Identifier') return prop.key.name
  if (prop.key.type === 'StringLiteral') return prop.key.value
  return null
}

/** 一个值节点 → 描述；只有字面量算「可改」 */
function describe(node, code) {
  if (!node) return null
  if (node.type === 'StringLiteral') return { kind: 'string', value: node.value, quote: code[node.start] }
  if (node.type === 'NumericLiteral') return { kind: 'number', value: node.value }
  if (node.type === 'BooleanLiteral') return { kind: 'boolean', value: node.value }
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'NumericLiteral') return { kind: 'number', value: -node.argument.value }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return { kind: 'string', value: node.quasis[0].value.cooked ?? '', quote: '`' }
  if (node.type === 'ObjectExpression') {
    const props = {}
    for (const p of node.properties) {
      const k = keyName(p)
      if (k) props[k] = describe(p.value, code)
    }
    return { kind: 'object', props, code: code.slice(node.start, node.end) }
  }
  return { kind: 'expr', code: code.slice(node.start, node.end) }
}

function attrNamed(opening, name) {
  return opening.attributes.find((a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === name) ?? null
}

function attrValueNode(attr) {
  if (!attr?.value) return null
  return attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value
}

/** 元素里只有一段文字时，这段文字可以直接改 */
function textChild(element) {
  const meaningful = element.children.filter((c) => !(c.type === 'JSXText' && c.value.trim() === ''))
  if (meaningful.length !== 1) return null
  const only = meaningful[0]
  if (only.type === 'JSXText') return { node: only, value: only.value.trim() }
  if (only.type === 'JSXExpressionContainer') {
    const d = describe(only.expression, '')
    if (d?.kind === 'string') return { node: only, value: String(d.value) }
  }
  return null
}

function nameOf(opening) {
  const n = opening.name
  if (n.type === 'JSXIdentifier') return n.name
  if (n.type === 'JSXMemberExpression') return `${n.object.name ?? '…'}.${n.property.name}`
  return 'element'
}

/**
 * 读出元素写死的属性。
 * @returns {{ name: string, attrs: Record<string, Descr>, children: { kind: 'text', value: string } | null } | null}
 */
export function inspect(parser, code, line, column) {
  const ast = parse(parser, code)
  const el = findElement(ast, line, column)
  if (!el) return null
  const attrs = {}
  for (const a of el.openingElement.attributes) {
    if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier') continue
    const name = a.name.name
    if (name === 'key' || name === 'ref' || name.startsWith('data-fm-')) continue
    const value = a.value == null ? { kind: 'boolean', value: true } : describe(attrValueNode(a), code)
    if (value) attrs[name] = value
  }
  const text = textChild(el)
  return { name: nameOf(el.openingElement), attrs, children: text ? { kind: 'text', value: text.value } : null }
}

export class EditError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

/** 字符串写成源码：保留原来的引号风格；JSX 属性里的普通字符串不支持转义，换行等情况改用表达式 */
function quoteString(value, quote) {
  const q = quote === "'" || quote === '`' ? quote : '"'
  if (q === '`') return `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\``
  const body = value.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), `\\${q}`).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  return `${q}${body}${q}`
}

function literal(value, quote) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new EditError('invalid_value', '数值无效')
    return String(Number(value.toFixed(6)))
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return quoteString(value, quote)
  throw new EditError('invalid_value', '只支持字符串、数字和布尔值')
}

const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b)

/**
 * 改一个值，返回新源码。
 *
 * @param edit.line / edit.column 元素位置
 * @param edit.path  ['text'] = 属性；['style','fontSize'] = style 对象里的一项；['#children'] = 元素里的文字
 * @param edit.value 新值
 * @param edit.expect 原值（字面量）：对不上说明源码已经变了，拒绝；
 *                    style 里原本没有这一项时传 null，表示「新增」
 * @param edit.expectCode 原值是表达式时（例如 C.ink）传它的代码：表示「换成固定值」，同样要对得上
 */
export function applyEdit(parser, code, edit) {
  const ast = parse(parser, code)
  const el = findElement(ast, edit.line, edit.column)
  if (!el) throw new EditError('element_not_found', '源码里找不到这个元素，可能已经被改动')
  const opening = el.openingElement
  const [head, sub] = edit.path

  const replaceValue = (node, quoteHint) => {
    const d = describe(node, code)
    if (edit.expectCode != null) {
      /* 把表达式换成固定值：原表达式必须一字不差，才能确定换的是用户看到的那一处 */
      if (code.slice(node.start, node.end) !== edit.expectCode) throw new EditError('source_changed', '源码已经变化，请重新读取')
    } else {
      if (d.kind !== 'string' && d.kind !== 'number' && d.kind !== 'boolean') throw new EditError('not_static', '这个值是计算出来的，不能直接改')
      if (!same(d.value, edit.expect)) throw new EditError('source_changed', '源码已经变化，请重新读取')
    }
    const quote = d.kind === 'string' ? d.quote : quoteHint
    return code.slice(0, node.start) + literal(edit.value, quote) + code.slice(node.end)
  }

  if (head === '#children') {
    const text = textChild(el)
    if (!text) throw new EditError('not_static', '元素里不只是一段文字，不能直接改')
    if (!same(text.value, edit.expect)) throw new EditError('source_changed', '源码已经变化，请重新读取')
    if (typeof edit.value !== 'string') throw new EditError('invalid_value', '文字必须是字符串')
    const node = text.node
    if (node.type === 'JSXText') {
      /* 保留原文字两侧的空白（换行缩进），只换中间那段；含特殊字符时改成表达式 */
      const raw = code.slice(node.start, node.end)
      const lead = raw.match(/^\s*/)[0]
      const trail = raw.match(/\s*$/)[0]
      const safe = /[{}<>\n]/.test(edit.value) ? `{${quoteString(edit.value, "'")}}` : edit.value
      return code.slice(0, node.start) + lead + safe + trail + code.slice(node.end)
    }
    return code.slice(0, node.expression.start) + literal(edit.value, describe(node.expression, code).quote) + code.slice(node.expression.end)
  }

  const attr = attrNamed(opening, head)
  if (!sub) {
    if (!attr) throw new EditError('not_static', `元素上没有 ${head} 属性`)
    const node = attrValueNode(attr)
    if (!node) throw new EditError('not_static', `${head} 没有值`)
    /* JSX 属性里的普通字符串（text="…"）不能写转义：新值含换行或引号时换成 {'…'} */
    if (attr.value.type === 'StringLiteral' && typeof edit.value === 'string' && /["\n\\]/.test(edit.value)) {
      const d = describe(node, code)
      if (d.kind !== 'string' || !same(d.value, edit.expect)) throw new EditError('source_changed', '源码已经变化，请重新读取')
      return code.slice(0, attr.value.start) + `{${quoteString(edit.value, "'")}}` + code.slice(attr.value.end)
    }
    return replaceValue(node, "'")
  }

  /* style 对象里的一项 */
  const obj = attrValueNode(attr)
  if (!attr || !obj || obj.type !== 'ObjectExpression') throw new EditError('not_static', `${head} 不是写死的对象，不能直接改`)
  const prop = obj.properties.find((p) => keyName(p) === sub)
  if (prop) return replaceValue(prop.value, "'")
  if (edit.expect !== null || edit.expectCode != null) throw new EditError('source_changed', '源码已经变化，请重新读取')
  /* 新增一项：跟着最后一项写，沿用它的缩进与逗号风格 */
  const entry = `${sub}: ${literal(edit.value, "'")}`
  const last = obj.properties[obj.properties.length - 1]
  if (!last) return code.slice(0, obj.start + 1) + entry + code.slice(obj.end - 1)
  const between = code.slice(last.end, obj.end - 1)
  const hasTrailingComma = /^\s*,/.test(between)
  const lineStart = code.lastIndexOf('\n', last.start) + 1
  const indent = code.slice(lineStart, last.start)
  const multiline = /^\s*$/.test(indent) && code.slice(obj.start, last.start).includes('\n')
  const insertAt = hasTrailingComma ? last.end + between.indexOf(',') + 1 : last.end
  const glue = multiline ? `${hasTrailingComma ? '' : ','}\n${indent}` : `${hasTrailingComma ? '' : ','} `
  return code.slice(0, insertAt) + glue + entry + (hasTrailingComma && multiline ? ',' : '') + code.slice(insertAt)
}
