/**
 * Highlight - ハイライトボックス
 */

import { C, font } from "../../../common";

export const Highlight = ({ x = 320, y = 180, width = 640, height = 360, progress = 1, label = "DEMO" }: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  progress?: number;
  label?: string;
}) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: width,
      height: height,
      border: `2px solid ${C.accent}`,
      borderRadius: 8,
      opacity: progress,
      transform: `scale(${progress})`,
      boxShadow: `0 0 20px ${C.accent}40`,
    }}
  >
    {label && (
      <div
        style={{
          position: "absolute",
          top: -30,
          left: 0,
          fontFamily: font,
          fontSize: 12,
          color: C.accent,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    )}
  </div>
);
