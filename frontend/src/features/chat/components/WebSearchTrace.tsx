import { useEffect, useMemo, useState } from "react";
import "@/features/chat/styles/web-search-trace.css";

/* ══ Web search trace ═══════════════════════════════════════
   一次联网搜索的「研究轨迹」。

   结构照 BoardUI 的 Web Search：它是一棵树，不是一列行。
   标题行在最左，下面用 7px 的桥接接到子层；每根子行再内缩 14px，
   左侧一条钩子接进贯通的竖干；某一行查到来源，就在它下面再嵌一层
   子枝（同样的桥接 + 缩进 + 钩子）。

   生长也是照它的三条动作来的：行高从 0 长出来、内容从下方 4px 浮上来
   并去掉 6px 模糊、钩子描出来、竖干拉出来。

   ── 只画真实发生过的事 ────────────────────────────────────
   没有内置示例步骤，也不按固定节奏假装往下播：每一行都来自 Agent
   真的发起过的工具调用。没有结果正文时就不显示来源 —— 编几个域名
   出来会让用户以为 Agent 真的看过那些页面。 */

export interface SearchCall {
  callId?: string;
  name: string;
  arguments?: string;
  done?: boolean;
  isError?: boolean;
}

/** 一条来源。后端把结果正文带上来之前，这里通常为空。 */
export interface SearchSource {
  title: string;
  domain: string;
  href?: string;
  /** 站点品牌，用来画真实标记；不认识的站点只画一个圆点 */
  brand?: string;
}

interface Step {
  key: string;
  label: string;
  query?: string;
  meta?: string;
  done: boolean;
  failed: boolean;
  sources: SearchSource[];
}

/** 哪些工具算联网搜索。只认明确是搜索的，不把 read_page 这类读页算进来。 */
export function isSearchTool(name: string): boolean {
  const n = name.toLowerCase();
  return n === "web_search" || n === "websearch" || n === "web-search"
    || n === "search_web" || n === "search" || n.includes("web_search");
}

/**
 * 从参数原文里取查询词。
 *
 * 参数是 JSON 原文（后端可能截断过），解析失败时退回原文 —— 显示一串
 * 原始 JSON 不好看，但比假装「搜索了」要诚实。
 */
function queryOf(raw?: string): string {
  if (!raw || !raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      for (const key of ["query", "q", "search", "term", "queries"]) {
        const value = obj[key];
        if (typeof value === "string" && value.trim()) return value.trim();
        if (Array.isArray(value)) {
          const first = value.find((v) => typeof v === "string" && v.trim());
          if (typeof first === "string") return first.trim();
        }
      }
    }
  } catch {
    /* 截断的 JSON 会抛在这里；退回原文即可 */
  }
  return raw.trim().slice(0, 100);
}

/**
 * 把真实的工具调用收成搜索步骤。
 *
 * @param calls 一轮的工具调用记录（实时与历史共用）
 * @param sources 可选的来源映射（按 callId），后端接上结果后由调用方提供
 */
function stepsOf(calls: SearchCall[], sources?: Record<string, SearchSource[]>): Step[] {
  return calls
    .filter((c) => isSearchTool(c.name))
    .map((c, i) => {
      const key = c.callId ?? `${c.name}-${i}`;
      const found = sources?.[key] ?? [];
      const query = queryOf(c.arguments);
      return {
        key,
        label: "网页搜索",
        query: query || undefined,
        meta: found.length > 0 ? `${found.length} 条来源` : undefined,
        done: c.done === true,
        failed: c.isError === true,
        sources: found,
      };
    });
}

/** 放大镜：与头像同一套 18 单位画法 */
function LensIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="7.6" cy="7.6" r="5.4" />
      <path d="M11.6 11.6 L15.4 15.4" />
    </svg>
  );
}

/**
 * 导轨：一条连续竖线 + 一个 CSS 弯钩。
 *
 * 纵向连续性只由 .wst-trunk 负责（top 0 / bottom 0 贯穿整行），
 * 弯钩只画横向拐出去那一段，不参与纵向 —— 这样不可能出现拼缝。
 *
 * @param first 第一行（保留属性，供需要时区分起点）
 * @param last  末行：竖线止于钩底，不再向下延伸
 */
function Rail({ first, last }: { first: boolean; last: boolean }) {
  return (
    <span className="wst-rail" aria-hidden="true" data-first={first || undefined} data-last={last || undefined}>
      <span className="wst-trunk" />
      <svg className="wst-hook" viewBox="0 0 12 15" fill="none">
        <path d="M0.5 0 V8 Q0.5 14 6.5 14 H11.5" stroke="currentColor" strokeWidth="1" />
      </svg>
    </span>
  );
}

/** 站点标记：认识的站点画品牌，不认识的画一个圆点 */
function Mark({ source }: { source: SearchSource }) {
  return (
    <span className="wst-mark" title={`${source.title} · ${source.domain}`}>
      {source.brand
        ? <span className={`wst-brand wst-brand-${source.brand}`} aria-hidden="true" />
        : <span className="wst-mark-dot" aria-hidden="true" />}
    </span>
  );
}

/**
 * 「来源」这一行：重叠标记 + 展开箭头，点开后是完整列表。
 *
 * 原组件在展开时把标记从堆叠位置平滑移进列表；这里用同一份标记的
 * 两种呈现加逐条落下，读法一致，不额外引入布局动画库。
 */
function SourcesRow({ sources, reduce }: { sources: SearchSource[]; reduce: boolean }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(0);
  const head = sources.slice(0, 6);
  const rest = sources.length - head.length;

  useEffect(() => {
    if (open && shown >= sources.length) return;
    if (!open && shown === 0) return;
    const timer = window.setTimeout(() => setShown((n) => (open ? n + 1 : n - 1)), reduce ? 0 : 100);
    return () => window.clearTimeout(timer);
  }, [open, shown, sources.length, reduce]);

  return (
    <div className="wst-sources-block">
      <button
        type="button"
        className="wst-sources-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="wst-sources-label">来源</span>
        <span className="wst-stack">
          {head.map((source, i) => (
            <Mark key={`${source.domain}-${i}`} source={source} />
          ))}
        </span>
        {rest > 0 && shown === 0 && <span className="wst-more">+{rest}</span>}
        <span className="wst-caret" data-open={open || undefined} aria-hidden="true">
          <svg viewBox="0 0 16 16"><path d="M4.5 6.5 L8 10 L11.5 6.5" /></svg>
        </span>
      </button>

      <ul className="wst-source-list">
        {sources.map((source, i) => {
          const visible = shown > sources.length - 1 - i;
          const Tag = source.href ? "a" : "div";
          return (
            <li key={`${source.domain}-${i}`} className="wst-source-row" data-visible={visible || undefined}>
              {visible ? <Mark source={source} /> : <span className="wst-mark" aria-hidden="true" />}
              <Tag
                className="wst-source-main"
                {...(source.href ? { href: source.href, target: "_blank", rel: "noreferrer noopener" } : {})}
              >
                <span className="wst-source-title" title={source.title}>{source.title}</span>
                <span className="wst-source-domain">{source.domain}</span>
              </Tag>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 一行步骤：图标 + 文案 +（可选）右侧计数 */
function StepLine({ step, active }: { step: Step; active: boolean }) {
  return (
    <div
      className="wst-step"
      data-state={step.failed ? "failed" : step.done ? "done" : "running"}
    >
      <span className="wst-icon"><LensIcon /></span>
      <p className="wst-line">
        <span className={active ? "wst-shimmer" : undefined}>{step.label}</span>
        {step.query && <span className="wst-query">{step.query}</span>}
      </p>
      {/* 失败必须带文字，不能只靠颜色（色弱也要能看出来），
          也与任务列表「状态字在行尾」的位置一致 */}
      {step.failed && <span className="wst-status" data-state="failed">失败</span>}
      {step.meta && <span className="wst-meta">{step.meta}</span>}
    </div>
  );
}

/**
 * 联网搜索轨迹。
 *
 * @param calls    本轮工具调用
 * @param live     是否来自正在进行的流（历史记录没有「执行中」）
 * @param sources  可选的来源映射（按 callId），后端接上结果后由调用方提供
 * @param revealed 可选的已揭示行数；不传时按顺序自己揭示
 */
export function WebSearchTrace({
  calls, live, sources, revealed,
}: {
  calls: SearchCall[];
  live: boolean;
  sources?: Record<string, SearchSource[]>;
  revealed?: number;
}) {
  const reduce = useMemo(
    () => typeof window !== "undefined"
      && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const steps = useMemo(() => stepsOf(calls, sources), [calls, sources]);

  const controlled = revealed !== undefined;
  const [seen, setSeen] = useState(0);
  /**
   * 抽屉开合。与任务列表（TaskList）同一套交互：
   * 标题行可点、箭头 90° 旋转、内容高度 0 ↔ auto。
   * 运行中强制展开 —— 用户此刻要看的就是它在查什么，
   * 收起等于把正在发生的事藏起来。
   */
  const [collapsed, setCollapsed] = useState(false);
  const count = controlled ? Math.max(0, Math.min(revealed, steps.length)) : seen;

  /* 新行按顺序长出：给用户「正在往下发生」的读法，而不是一次铺满 */
  useEffect(() => {
    if (controlled || count >= steps.length) return;
    const timer = window.setTimeout(
      () => setSeen((n) => n + 1),
      count === 0 ? 320 : 900,
    );
    return () => window.clearTimeout(timer);
  }, [controlled, count, steps.length]);

  if (steps.length === 0) return null;

  const visible = steps.slice(0, Math.max(1, count));
  const running = live ? visible.filter((s) => !s.done).length : 0;
  const failed = visible.filter((s) => s.failed).length;
  /* 标题行只在多次搜索时出现：一次搜索不必先宣告「跑了 1 次」 */
  const showHead = steps.length > 1;

  return (
    <section
      className="wst"
      data-state={failed > 0 ? "failed" : running > 0 ? "running" : "done"}
      /* 有没有标题行：没有时最外层那根连接线上方是空的，CSS 据此不画它 */
      data-head={showHead || undefined}
      aria-live="polite"
    >
      {showHead && (
        <button
          type="button"
          className="wst-head"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="wst-icon"><LensIcon /></span>
          {/* 标题与任务列表同一套命名：「名称 · N 次」。 */}
          <span className="wst-head-title">网页搜索 · {steps.length} 次</span>
          {/* 复用来源行那个 wst-caret：同一个箭头形状、同一条缓动，
              不另外引一个图标组件（两处箭头长得不一样会被看出来） */}
          <span className="wst-caret" data-open={!collapsed || undefined} aria-hidden="true">
            <svg viewBox="0 0 16 16"><path d="M4.5 6.5 L8 10 L11.5 6.5" /></svg>
          </span>
        </button>
      )}

      <div className="wst-children" data-collapsed={(showHead && collapsed) || undefined}>
        <ul className="wst-rows">
          {visible.map((step, i) => {
            const isLastStep = i === visible.length - 1;
            /* 有来源分支时，这一行下面还挂着子树 —— 竖干必须继续画到
               子树底部，否则分支底下会断一截（看着就是「线短了」）。
               所以「末行」的判据是：既是最后一行、又没有任何子枝。 */
            const hasBranch = step.sources.length > 0;
            const last = isLastStep && !hasBranch;
            /* 最后一行且还在跑：微光 */
            const active = !reduce && live && !step.done && isLastStep;
            return (
              <li
                key={step.key}
                className="wst-row"
                data-first={i === 0 || undefined}
                data-last={last || undefined}
              >
                <Rail first={i === 0} last={last} />
                <div className="wst-body">
                  <StepLine step={step} active={active} />

                  {hasBranch && (
                    <div className="wst-children">
                      <ul className="wst-rows">
                        <li className="wst-row" data-last>
                          <Rail first={false} last />
                          <div className="wst-body">
                            <SourcesRow sources={step.sources} reduce={reduce} />
                          </div>
                        </li>
                      </ul>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
