import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import "./bencho-blocks.css";

/* ══ Context meter ════════════════════════════════════════
   A model's context window as a field of dots, one per thousand
   tokens. Each kind of content fills its own band, column by column,
   in its own strength of ink, and the empty room is a faint grid.
   Point at a chip, or at any dot, and that kind lights while the rest
   fall back, and the big number rolls to its share.

   ── EVERY DOT IS AN INDEX ───────────────────────────────
   Dot i belongs to whichever kind's running total it falls inside,
   so a dot never moves: when the totals change, which kind each index
   belongs to changes, and the colour change is the animation. A delay
   that grows along the indices that changed makes it a ripple rather
   than a cut.

   ── THE FIGURE POPS IN ──────────────────────────────────
   The Price flow block's number pop-in, recycled: a digit that
   changes rises a hair out of a 2px blur and lands a touch past
   its mark, left to right 70ms apart — from below when the figure
   grows, from above when it shrinks. Every digit is keyed by its
   place and its value, so one that did not change never moves.

   ── 本项目的改造（与原版的差异，均已落实在代码里）──────────
   原版是五个写死的假数据档位（System/Tools/Files/Chat/Memory），
   还带一个只改本地 state 的「Compact」按钮。这里改成：
   1) 档位由 `parts` 传入，只保留 DSH 真有的三档
      （system / tools / messages）—— 本项目拿不到 Files 和 Memory，
      硬画出来就是编数据。
   2)「Compact」按钮去掉：它在本项目里没有真实动作可接，
      留着只会是个按了不生效的假按钮。
   3) 分母由 `window` 传入（DSH 的 request/context.contextWindow）。 */

/** 一档内容的占用。`tokens` 是真实或启发式 token 数。 */
export type MeterPart = {
  id: string;
  /** 界面上的名字。 */
  name: string;
  tokens: number;
  /** 该档是否为启发式估算 —— 界面须标注，不能冒充实测。 */
  estimated?: boolean;
};

export type MeterStyle = "Field" | "Bar";

/* the field's grid: 20 across, 10 down, each an exact 11 by 11
   on a 3px gap, so every one is the same true square */
const COLS = 20;
const ROWS = 10;
const DOT_W = 11;
const DOT_H = 11;
const GAP = 3;

/** 数字滚动：变大从下方升起，变小从上落下。 */
function Roll({ text, up }: { text: string; up: boolean }) {
  const chars = text.split("");
  /* places counted from the right, so a new leading digit does not
     shift the keys of the ones already there */
  return (
    <span className="ctx-roll" aria-hidden="true">
      {chars.map((c, i) => {
        const place = chars.length - 1 - i;
        if (!/[0-9]/.test(c)) return <span key={`s${place}`} className="ctx-sym">{c}</span>;
        return (
          <span key={`p${place}`} className="ctx-wheel">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={c}
                className="ctx-digit"
                initial={{ y: up ? "0.18em" : "-0.18em", opacity: 0, filter: "blur(2px)" }}
                animate={{ y: "0em", opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(2px)", transition: { duration: 0.16 } }}
                transition={{ duration: 0.5, ease: [0.34, 1.45, 0.64, 1], delay: i * 0.07 }}
              >
                {c}
              </motion.span>
            </AnimatePresence>
          </span>
        );
      })}
    </span>
  );
}

/* the bar's corners: OUTER at its two ends, INNER where pieces meet */
const OUTER = 6;
const INNER = 2;
const corners = (first: boolean, last: boolean) => ({
  borderTopLeftRadius: first ? OUTER : INNER,
  borderBottomLeftRadius: first ? OUTER : INNER,
  borderTopRightRadius: last ? OUTER : INNER,
  borderBottomRightRadius: last ? OUTER : INNER,
});

/**
 * 紧凑写法：1234 → 1.2K、1234567 → 1.2M。
 * 上下文用量动辄百万级，写全数字既占地方又看不清量级。
 */
function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

/**
 * 上下文用量条（来源：Bencho「Context meter」，MIT）。
 *
 * 设计令牌已映射到本项目主题（见 bencho-blocks.css 顶部说明），
 * 因此在 dark / light / tactile 三套主题下都跟随项目配色。
 *
 * **调用方必须传真实数据**：`parts` 分档、`window` 分母。这里不做任何
 * 兜底假数据 —— 拿不到就由调用方不渲染本组件。
 */
export function ContextMeter({
  /* 各档占用；按此顺序在条上排列 */
  parts,
  /* 上下文窗口总 token 数（分母） */
  window: windowTokens,
  /* a field of dots, or one stacked bar */
  style = "Bar",
  /* the hues, or strengths of the ink */
  colour = "Colour",
}: {
  parts: MeterPart[];
  window: number;
  style?: MeterStyle;
  colour?: "Colour" | "Mono";
}) {
  const [hot, setHot] = useState<string | null>(null);
  const used = parts.reduce((a, b) => a + b.tokens, 0);
  /* 占用可能因估算误差略微超过窗口，钳住避免 flexGrow 变负 */
  const room = Math.max(0, windowTokens - used);
  const ratio = windowTokens > 0 ? used / windowTokens : 0;

  /* 固定 200 格铺满整窗：空出来的部分才是真实比例 */
  const totalDots = COLS * ROWS;
  const perDot = windowTokens > 0 ? windowTokens / totalDots : 1;
  const owners: (number | null)[] = [];
  parts.forEach((p, i) => {
    const dots = Math.round(p.tokens / perDot);
    for (let j = 0; j < dots && owners.length < totalDots; j++) owners.push(i);
  });
  while (owners.length < totalDots) owners.push(null);

  const hotIdx = hot ? parts.findIndex((c) => c.id === hot) : -1;
  const target = hotIdx >= 0 ? parts[hotIdx].tokens : used;
  const last = useRef(target);
  const up = useRef(true);
  if (target !== last.current) { up.current = target > last.current; last.current = target; }

  const anyEstimated = parts.some((p) => p.estimated);

  return (
    <div
      className="ctx"
      data-hot={hot || undefined}
      data-mono={colour === "Mono" || undefined}
      onPointerLeave={() => setHot(null)}
    >
      {/* 原版这里还有一个「Compact」按钮。本项目没有真实的压缩动作可接，
          留着就是个按了不生效的假按钮，所以删掉，右上角改显示占用率。 */}
      <div className="ctx-head">
        <span className="ctx-title">Context</span>
        <span className="ctx-of">
          {Math.round(ratio * 100)}%
          {anyEstimated && <span title="分档为估算值"> · 估算</span>}
        </span>
      </div>
      <div className="ctx-figure" aria-live="polite">
        <span className="ctx-num">
          <span className="ctx-sr">{short(target)}</span>
          <Roll text={short(target)} up={up.current} />
        </span>
        <span className="ctx-of" title={`${target.toLocaleString()} / ${windowTokens.toLocaleString()} tokens`}>
          {hotIdx >= 0 ? parts[hotIdx].name : `of ${short(windowTokens)}`}
        </span>
        {/* 百分比原本在标题行里；紧凑布局把标题行藏了，这里接过来，
            否则「装了几成」这个最该一眼看到的数字反而没了 */}
        <span className="ctx-pct" title={anyEstimated ? '分档为估算值，总量为实测值' : undefined}>
          {Math.round(ratio * 100)}%{anyEstimated ? ' · 估算' : ''}
        </span>
      </div>
      {style === "Bar" ? (
        /* the bar: one segment per kind, as wide as its share, and the
           room left as a faint tail */
        <div className="ctx-bar" aria-hidden="true" onPointerLeave={() => setHot(null)}>
          {parts.map((c, n) => (
            <i
              key={c.id}
              className="ctx-seg"
              data-kind={c.id}
              data-dim={(hot !== null && c.id !== hot) || undefined}
              /* the bar is one rounded shape cut into pieces: round at
                 its two ends, nearly square where two pieces meet */
              style={{
                flexGrow: c.tokens,
                ...corners(n === 0, false),
              } as React.CSSProperties}
              onPointerEnter={() => setHot(c.id)}
            />
          ))}
          <i
            className="ctx-seg ctx-seg-room"
            style={{ flexGrow: room, ...corners(false, true) }}
            data-dim={hot !== null || undefined}
            onPointerEnter={() => setHot(null)}
          />
        </div>
      ) : (
        <div
          className="ctx-grid"
          style={{
            /* fixed tracks, not fractions: a fraction lands each column on
               its own sub-pixel, and neighbouring squares round to
               different sizes */
            gridTemplateRows: `repeat(${ROWS}, ${DOT_H}px)`,
            gridTemplateColumns: `repeat(${COLS}, ${DOT_W}px)`,
            gap: GAP,
          }}
          aria-hidden="true"
          onPointerLeave={() => setHot(null)}
        >
          {owners.map((o, i) => (
            <i
              key={i}
              className="ctx-dot"
              data-kind={o === null ? undefined : parts[o].id}
              data-dim={(hot !== null && (o === null || parts[o].id !== hot)) || undefined}
              onPointerEnter={() => setHot(o === null ? null : parts[o].id)}
            />
          ))}
        </div>
      )}
      <div className="ctx-chips" onPointerLeave={() => setHot(null)}>
        {parts.map((c) => (
          <button
            key={c.id}
            type="button"
            className="ctx-chip"
            data-on={hot === c.id || undefined}
            onPointerEnter={() => setHot(c.id)}
            onFocus={() => setHot(c.id)}
            onBlur={() => setHot(null)}
            title={`${c.name}：${c.tokens.toLocaleString()} tokens${c.estimated ? '（估算）' : ''}`}
          >
            <i className="ctx-swatch" data-kind={c.id} />
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export default ContextMeter;
