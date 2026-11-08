import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import "./bencho-blocks.css";

/* ══ Context meter ════════════════════════════════════════
   A model's context window as a field of dots, one per thousand
   tokens. Each kind of content fills its own band, column by column,
   in its own strength of ink, and the empty room is a faint grid.
   Point at a chip, or at any dot, and that kind lights while the rest
   fall back, and the big number rolls to its share. Compact folds the
   conversation down: its dots go out in a ripple from the far end,
   the bands after it close up, and the count rolls down with them.

   ── EVERY DOT IS AN INDEX ───────────────────────────────
   Dot i belongs to whichever kind's running total it falls inside,
   so a dot never moves: compacting changes which kind each index
   belongs to, and the colour change is the animation. A delay that
   grows along the indices that changed makes it a ripple rather
   than a cut.

   ── THE FIGURE POPS IN ──────────────────────────────────
   The Price flow block's number pop-in, recycled: a digit that
   changes rises a hair out of a 2px blur and lands a touch past
   its mark, left to right 70ms apart — from below when the figure
   grows, from above when it shrinks. Every digit is keyed by its
   place and its value, so one that did not change never moves.

   ── 本项目的改造（与原版的差异）──────────────────────────
   1) 五个档位由 `parts` 传入真实数据，不再写死示例值。
   2) 一个点代表多少 token 由 `window` 推导（窗口 / 200），
      而不是固定 1K —— 窗口 1M 时一个点是 5K。
   3) Compact 折叠的是本地「显示」的对话档，没有后端压缩动作 ——
      按下后按钮变成 Undo，语义是「预览压缩后的样子」。 */

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

/* which kind each dot is, before and after compacting: running
   totals, a dot per thousand. Both are fixed, so the dots that
   differ between them — and so the ripple's delays — are too */
function ownersFor(sizes: number[], order: number[], totalDots: number): (number | null)[] {
  const out: (number | null)[] = [];
  order.forEach((ci) => {
    const dots = Math.round(sizes[ci]);
    for (let j = 0; j < dots && out.length < totalDots; j++) out.push(ci);
  });
  while (out.length < totalDots) out.push(null);
  return out;
}

/* the whole ripple fits inside the compact sound's squeeze: every dot
   that changes has started by RIPPLE ms, so the swap lands with the
   knock at ~280 rather than trailing on for a second after it.
   1 rather than 0 for the first, since 0 reads as "unchanged" */
const RIPPLE = 220;

function delaysFor(before: (number | null)[], after: (number | null)[]): number[] {
  const first = before.findIndex((o, i) => o !== after[i]);
  const last = before.reduce<number>((l, o, i) => (o !== after[i] ? i : l), first);
  if (first < 0) return before.map(() => 0);
  return before.map((o, i) =>
    o !== after[i] ? 1 + Math.round(((i - first) / (last - first || 1)) * RIPPLE) : 0,
  );
}

/** Compact 时把对话压到原来的一成多 —— 与「压缩后只剩摘要」的量级相符。 */
const COMPACT_RATIO = 0.12;

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
  const [compact, setCompact] = useState(false);
  const [moved, setMoved] = useState(false);

  /* 一格代表多少 token：窗口的 1/200。
     原版写死「one per thousand」，因为它的示例窗口正好 200K、格子正好 200。
     本项目窗口是 1M，沿用 1K 一格的话 200 格只盖住 200K、剩下全是空的；
     按窗口的 1/200 则点阵永远铺满整窗，点亮比例 = 真实占用比例。
     代价是一格不再等于 1K，所以格子数由窗口决定而非固定 200。 */
  const totalDots = COLS * ROWS;
  const perDot = windowTokens > 0 ? windowTokens / totalDots : 1000;

  /* Compact 只折叠对话这一档，其余不动 —— 压缩动的就是历史对话 */
  const isChat = (id: string) => id === "chat" || id === "messages";
  const sizes = parts.map((p) =>
    isChat(p.id) && compact ? Math.round(p.tokens * COMPACT_RATIO) : p.tokens,
  );
  const used = sizes.reduce((a, b) => a + b, 0);
  /* 占用可能因估算误差略微超过窗口，钳住避免 flexGrow 变负 */
  const room = Math.max(0, windowTokens - used);

  /* biggest first, as it stands before compacting: the order of the
     field, the bar and the chips alike. Fixed, so Compact shrinks the
     chat in place rather than reshuffling the bands */
  const order = parts.map((_, i) => i).sort((a, b) => parts[b].tokens - parts[a].tokens);

  const dotsBefore = ownersFor(parts.map((p) => p.tokens / perDot), order, totalDots);
  const dotsAfter = ownersFor(
    parts.map((p) => (isChat(p.id) ? (p.tokens * COMPACT_RATIO) / perDot : p.tokens / perDot)),
    order,
    totalDots,
  );
  const owner = compact ? dotsAfter : dotsBefore;
  const was = compact ? dotsBefore : dotsAfter;
  const delays = delaysFor(dotsBefore, dotsAfter);

  const hotIdx = hot ? parts.findIndex((c) => c.id === hot) : -1;
  const target = hotIdx >= 0 ? sizes[hotIdx] : used;
  const last = useRef(target);
  const up = useRef(true);
  if (target !== last.current) {
    up.current = target > last.current;
    last.current = target;
  }

  const anyEstimated = parts.some((p) => p.estimated);
  const ratio = windowTokens > 0 ? used / windowTokens : 0;

  return (
    <div
      className="ctx"
      data-hot={hot || undefined}
      data-mono={colour === "Mono" || undefined}
      onPointerLeave={() => setHot(null)}
    >
      {/* only what reads at a glance: the name, and the one action */}
      <div className="ctx-head">
        <span className="ctx-title">Context</span>
        <button
          type="button"
          className="ctx-act"
          data-quiet={compact || undefined}
          onClick={() => {
            setMoved(true);
            setCompact((v) => !v);
          }}
        >
          {compact ? "Undo" : "Compact"}
        </button>
      </div>
      <div className="ctx-figure" aria-live="polite">
        <span className="ctx-num">
          <span className="ctx-sr">{short(target)}</span>
          <Roll text={short(target)} up={up.current} />
        </span>
        <span
          className="ctx-of"
          title={`${target.toLocaleString()} / ${windowTokens.toLocaleString()} tokens`}
        >
          {hotIdx >= 0 ? parts[hotIdx].name : `of ${short(windowTokens)}`}
        </span>
        {/* 百分比原本在标题行里；紧凑布局把标题行藏了，这里接过来，
            否则「装了几成」这个最该一眼看到的数字反而没了 */}
        <span className="ctx-pct" title={anyEstimated ? "分档为估算值，总量为实测值" : undefined}>
          {Math.round(ratio * 100)}%{anyEstimated ? " · 估算" : ""}
        </span>
      </div>
      {style === "Bar" ? (
        /* the bar: one segment per kind, as wide as its share, and the
           room left as a faint tail. Compact eases the chat's width */
        /* ── COMPACT SQUEEZES, IT DOES NOT RESHUFFLE ──────────
           The order is the uncompacted one, biggest first, and it
           never changes: re-sorting made the chat and the files
           cross each other mid-move. The widths are real flex-grow
           transitions rather than a layout scale, so the corners
           stay true every frame; the chat gives a squeeze as it
           folds, and a softer one runs down the bar after it.
           `data-wave` flips a/b on every press, which is what
           restarts the keyframes. */
        <div
          className="ctx-bar"
          aria-hidden="true"
          data-wave={moved ? (compact ? "a" : "b") : undefined}
          onPointerLeave={() => setHot(null)}
        >
          {order.map((ci, n) => {
            const c = parts[ci];
            return (
              <i
                key={c.id}
                className="ctx-seg"
                data-kind={c.id}
                data-dim={(hot !== null && c.id !== hot) || undefined}
                /* the bar is one rounded shape cut into pieces: round at
                   its two ends, nearly square where two pieces meet */
                style={{
                  flexGrow: sizes[ci],
                  ...corners(n === 0, false),
                  "--ctx-wave": `${n * 55}ms`,
                  "--ctx-give": isChat(c.id) ? 0.78 : 0.93,
                } as React.CSSProperties}
                onPointerEnter={() => setHot(c.id)}
              />
            );
          })}
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
          /* the field gives under the press as the bar does */
          data-wave={moved ? (compact ? "a" : "b") : undefined}
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
          {owner.map((o, i) => {
            const wasKind = was[i];
            return (
              <i
                /* a dot that changes kind is a new element, so its swap
                 animation starts again; the rest keep theirs */
                key={moved && delays[i] ? `${i}${compact ? "+" : "-"}` : i}
                className="ctx-dot"
                data-kind={o === null ? undefined : parts[o].id}
                data-swap={moved && delays[i] ? (o === null ? "drain" : "fill") : undefined}
                data-dim={(hot !== null && (o === null || parts[o].id !== hot)) || undefined}
                style={delays[i] ? ({
                  transitionDelay: `${delays[i]}ms`,
                  animationDelay: `${delays[i]}ms`,
                  "--was": wasKind === null ? "var(--ctx-empty)" : `var(--k-${parts[wasKind].id})`,
                  "--now": o === null ? "var(--ctx-empty)" : `var(--k-${parts[o].id})`,
                } as React.CSSProperties) : undefined}
                onPointerEnter={() => setHot(o === null ? null : parts[o].id)}
              />
            );
          })}
        </div>
      )}
      <div className="ctx-chips" onPointerLeave={() => setHot(null)}>
        {order.map((ci) => parts[ci]).map((c) => (
          <button
            key={c.id}
            type="button"
            className="ctx-chip"
            data-on={hot === c.id || undefined}
            onPointerEnter={() => setHot(c.id)}
            onFocus={() => setHot(c.id)}
            onBlur={() => setHot(null)}
            title={`${c.name}：${c.tokens.toLocaleString()} tokens${c.estimated ? "（估算）" : ""}`}
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
