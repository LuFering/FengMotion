/**
 * Visual Encoding starter（可复制到 Remotion 项目）
 *
 * 用途：把“画面设计”先写成可计算的 tokens / keyframes / shot spec，
 * 让模型在渲染前就能推理构图、时间、缓动、焦点与可见窗口。
 *
 * 这不是运行时依赖，也不是 validator；项目按需复制/扩展。
 */

export type EasingName =
  | 'linear'
  | 'inCubic'
  | 'outCubic'
  | 'inOutCubic'
  | 'outQuint';

export const EASING: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
};

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type Keyframe<T> = {
  frame: number;
  value: T;
  ease?: EasingName; // 到达该关键帧所用的缓动
};

export const seconds = (s: number, fps = 30) => Math.round(s * fps);

/** 在关键帧序列中取当前帧的值；首尾自动夹紧。 */
export const at = <T>(frame: number, frames: Keyframe<T>[], fallback: T): T => {
  if (frames.length === 0) return fallback;
  if (frame <= frames[0].frame) return frames[0].value;
  const last = frames[frames.length - 1];
  if (frame >= last.frame) return last.value;

  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1];
    const next = frames[i];
    if (frame > next.frame) continue;
    const span = Math.max(1, next.frame - prev.frame);
    const raw = clamp01((frame - prev.frame) / span);
    const eased = EASING[next.ease ?? 'linear'](raw);
    if (typeof prev.value === 'number' && typeof next.value === 'number') {
      return lerp(prev.value, next.value, eased) as T;
    }
    // 非数值关键帧：缓动只影响切换点，不做插值。
    return eased < 1 ? prev.value : next.value;
  }
  return last.value;
};

export type DesignTokens = {
  color: Record<string, string>;
  type: {
    family: string;
    scale: number[]; // 标题/正文/字幕等字号，按层级从大到小
    lineHeight: number;
  };
  grid: {
    columns: number;
    margin: number;
    gutter: number;
  };
  motion: {
    fast: number;
    base: number;
    slow: number;
    ease: EasingName;
  };
  camera: {
    height: number;
    focal: number;
  };
  light: {
    key: string;
    fill: string;
    falloff: number;
  };
};

export type CameraState = {
  x: number;
  y: number;
  scale: number;
  rotate: number;
};

export type ActionState = {
  progress: number; // 0–1
  emphasis: number; // 0–1，哪一拍是视觉重点
};

export type ShotSpec = {
  from: number;
  duration: number;
  fps: number;
  /** 帧级关键帧；相机/焦点/动作分别写。 */
  camera: Keyframe<CameraState>[];
  focus: Keyframe<string>[];
  action: Keyframe<ActionState>[];
  /** 关键元素在屏幕上的归一化可见窗口。 */
  visible: { start: number; end: number };
  safe: { top: number; right: number; bottom: number; left: number };
};

export const shotEnd = (shot: ShotSpec) => shot.from + shot.duration;

export const inVisibleWindow = (shot: ShotSpec, frame: number) =>
  frame >= shot.visible.start && frame <= shot.visible.end;

/** 渲染前可跑的轻量检查：不依赖像素，只检查编码本身。 */
export const checkShot = (shot: ShotSpec): string[] => {
  const errors: string[] = [];
  if (shot.duration <= 0) errors.push('duration 必须大于 0');
  if (shot.visible.start < shot.from) errors.push('visible.start 早于 shot.from');
  if (shot.visible.end > shotEnd(shot)) errors.push('visible.end 超出镜头');
  if (shot.visible.start > shot.visible.end) errors.push('visible 窗口反向');

  for (const k of [...shot.camera, ...shot.focus, ...shot.action]) {
    if (!Number.isFinite(k.frame)) errors.push('关键帧 frame 不是有限数');
    if (k.frame < shot.from || k.frame > shotEnd(shot)) {
      errors.push(`关键帧 ${k.frame} 超出镜头 [${shot.from}, ${shotEnd(shot)}]`);
    }
  }

  const { top, right, bottom, left } = shot.safe;
  if (top < 0 || right < 0 || bottom < 0 || left < 0) {
    errors.push('safe area 不能为负');
  }
  return errors;
};

/**
 * 示例（复制后按项目填写）：
 *
 * const shot: ShotSpec = {
 *   from: 0,
 *   duration: 150,
 *   fps: 30,
 *   camera: [
 *     { frame: 0, value: { x: 0, y: 0, scale: 1.02, rotate: 0 }, ease: 'outCubic' },
 *     { frame: 150, value: { x: -20, y: 0, scale: 1.08, rotate: 0 } },
 *   ],
 *   focus: [
 *     { frame: 0, value: 'grinder' },
 *     { frame: 90, value: 'cup', ease: 'inOutCubic' },
 *   ],
 *   action: [
 *     { frame: 0, value: { progress: 0, emphasis: 0 } },
 *     { frame: 90, value: { progress: 0.6, emphasis: 0.2 }, ease: 'outCubic' },
 *     { frame: 150, value: { progress: 1, emphasis: 1 } },
 *   ],
 *   visible: { start: 0, end: 150 },
 *   safe: { top: 80, right: 96, bottom: 80, left: 96 },
 * };
 *
 * const errors = checkShot(shot);
 * if (errors.length) throw new Error(errors.join('\n'));
 */
