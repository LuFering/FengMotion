import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AgentProgress } from "@/components/AgentProgress";

const STEPS = [
  "读取项目文件",
  "更新并安装浅色模式 token",
  "实现深色模式 token",
  "添加可复用的主题切换控件",
  "运行 registry、lint 与生产构建",
];

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <figure>
      <figcaption>{title}</figcaption>
      {children}
    </figure>
  );
}

function Demo() {
  const [k, setK] = useState(0);
  return (
    <>
      <Frame title="展开 · 运行中">
        <AgentProgress key={`open-${k}`} steps={STEPS} stepDuration={2400} />
      </Frame>
      <Frame title="收起态">
        <AgentProgress key={`min-${k}`} steps={STEPS} stepDuration={2400} defaultMinimized />
      </Frame>
      <Frame title="两步">
        <AgentProgress key={`two-${k}`} steps={["读取项目文件", "运行构建"]} stepDuration={2000} />
      </Frame>
      <div style={{ flexBasis: "100%", height: 0 }} />
      <button
        type="button"
        onClick={() => setK((n) => n + 1)}
        style={{
          padding: "7px 16px", border: "1px solid var(--line)", borderRadius: 8,
          background: "var(--surf)", color: "var(--fg)", fontSize: 13, cursor: "pointer",
        }}
      >
        重新播放
      </button>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Demo />);
