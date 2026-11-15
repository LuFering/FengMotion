import type { MotionOptions, MotionController } from "./motion-runtime";
export type ElasticPanelResizeOptions = MotionOptions;
export function elasticPanelFeedback(raw: number, bounded: number, speed: number): { offset: number; bend: number; stretch: number };
export function mountElasticPanelResize(target: HTMLElement, options?: ElasticPanelResizeOptions): MotionController;
