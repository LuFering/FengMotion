/**
 * Markdown 渲染 —— AI 回复正文。
 *
 * 之前对话区只有一个手写的 renderRich，只认 **加粗**、反引号和 `1. ` 编号列表。
 * AI 回复里常见的代码块、表格、多级列表、链接全都走样，等于把结构信息丢了。
 *
 * 用 react-markdown + remark-gfm：
 *   · gfm 补上表格、删除线、自动链接（AI 回复里表格很常见）
 *   · 代码块交给 shiki，在浅色/深色两套主题下都取到真实配色
 *   · 不做 raw HTML（不用 rehype-raw）：AI 输出里的 HTML 不该被执行
 *
 * ⚠️ shiki 是异步加载的（它要按需载入语言语法与主题）。
 * 加载完成前先用等宽字体渲染纯文本，不做骨架屏 ——
 * 一段代码晚 20ms 上色比先闪一块灰框更不打扰。
 */

import { useEffect, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import '@/features/chat/styles/components/markdown.css'

/* ── shiki 单例 ──────────────────────────────────────────────
   高亮器很重（几百 KB），整个应用只该有一个实例，且只在真的出现代码块时
   才去载入。用一个模块级 Promise 缓存，多个代码块共享同一次初始化。 */

type Highlighter = {
  codeToHast: (
    code: string,
    opts: { lang: string; themes: Record<string, string> },
  ) => unknown
}

let highlighterPromise: Promise<Highlighter> | null = null

function loadHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((m) =>
      m.createHighlighter({
        /* 只带对话里真会出现的语言，避免把全部语法包打进来 */
        langs: ['bash', 'json', 'ts', 'tsx', 'js', 'jsx', 'python', 'sql', 'yaml', 'markdown', 'diff', 'text'],
        themes: ['github-light', 'github-dark'],
      }) as unknown as Promise<Highlighter>,
    )
  }
  return highlighterPromise
}

/* ── 代码块 ────────────────────────────────────────────────── */

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadHighlighter()
      .then((hl) => {
        if (cancelled) return
        const hast = hl.codeToHast(code, {
          lang: SUPPORTED.has(lang) ? lang : 'text',
          themes: { light: 'github-light', dark: 'github-dark' },
        })
        setHtml(hastToHtml(hast))
      })
      .catch(() => {
        /* 高亮失败就保持纯文本：代码本身仍然可读，不该因为上色失败而消失 */
      })
    return () => {
      cancelled = true
    }
  }, [code, lang])

  return (
    <div className="md-code">
      {lang ? <span className="md-code-lang">{lang}</span> : null}
      {html ? (
        <div className="md-code-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="md-code-body md-code-fallback">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}

/** shiki 支持的语言集合，用于把不认识的语言名降级成 text 而不是报错 */
const SUPPORTED = new Set([
  'bash', 'sh', 'shell', 'json', 'ts', 'typescript', 'tsx', 'js', 'javascript',
  'jsx', 'python', 'py', 'sql', 'yaml', 'yml', 'markdown', 'md', 'diff', 'text', 'txt',
])

/**
 * 把 shiki 的 HAST 转成 HTML 字符串。
 *
 * 为什么不用 `hast-util-to-html`：为一个函数多引一个依赖不值当。
 * 这里只处理 shiki 会产出的节点类型（element / text），足够且可控。
 * 属性值只做必要的转义，元素名与属性名来自 shiki 自身，不来自用户输入。
 */
function hastToHtml(node: unknown): string {
  const n = node as {
    type?: string
    tagName?: string
    value?: string
    properties?: Record<string, unknown>
    children?: unknown[]
  }
  if (n?.type === 'text') return escapeHtml(n.value ?? '')
  if (!n?.tagName) return (n?.children ?? []).map(hastToHtml).join('')
  const attrs = Object.entries(n.properties ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k}="${escapeAttr(String(v))}"`)
    .join(' ')
  const inner = (n.children ?? []).map(hastToHtml).join('')
  return `<${n.tagName}${attrs ? ` ${attrs}` : ''}>${inner}</${n.tagName}>`
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

/* ── 对外组件 ──────────────────────────────────────────────── */

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`md${className ? ` ${className}` : ''}`}>
      <Markdown
        /* remark-breaks 是必需的：Markdown 规范里单个换行不算换行，
           必须空一行才是新段落。但 AI 回复的排版习惯是「一行一句」，
           不启用它，回复里所有单换行会被合并成一大段 —— 真机验收时
           看到的就是一段带 \n 字面量的文字，完全没法读。 */
        remarkPlugins={[remarkGfm, remarkBreaks]}
        /* 不启用 raw HTML：AI 输出里的 HTML 不执行 */
        components={{
          /* 链接一律新窗口打开，并且不带 opener —— 回复里的链接不该拿到本窗口的引用 */
          a: ({ href, children }: { href?: string; children?: ReactNode }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          /* 代码块走 shiki；行内代码保持轻量，不上色器 */
          code: ({ className: cls, children }: { className?: string; children?: ReactNode }) => {
            const raw = String(children ?? '')
            const match = /language-([\w-]+)/.exec(cls ?? '')
            /* 有 language-* 才是块级；否则是行内 `code` */
            if (!match) return <code className="md-inline-code">{raw.replace(/\n$/, '')}</code>
            return <CodeBlock code={raw.replace(/\n$/, '')} lang={match[1]} />
          },
          /* react-markdown 默认会给块级代码再套一层 <pre>，这里已经自带容器，去掉 */
          pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

export default MarkdownText
