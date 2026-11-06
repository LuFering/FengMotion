import "@/index.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AgentProgress } from "@/components/AgentProgress";
import { AgentThinking } from "@/components/AgentThinking";
import { ThinkingOrb, type OrbState } from "@/components/thinking-orbs";

const STEPS = [
  "读取项目文件",
  "更新并安装浅色模式 token",
  "实现深色模式 token",
  "添加可复用的主题切换控件",
  "运行 registry、lint 与生产构建",
];

const ORB_STATES: OrbState[] = [
  "working", "searching", "solving", "listening",
  "connecting", "weaving", "composing", "breathing", "shaping",
];

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="demo-section">
      <h2>{title}</h2>
      {note && <p className="demo-note">{note}</p>}
      <div className="demo-body">{children}</div>
    </section>
  );
}

function Demo() {
  const [k, setK] = useState(0);
  return (
    <div className="demo-root">
      <header className="demo-header">
        <h1>AI 组件三件套</h1>
        <button type="button" className="demo-replay" onClick={() => setK((n) => n + 1)}>
          重新播放
        </button>
      </header>

      <Section title="AgentProgress · 任务进度" note="照 BoardUI 复刻，换步时高亮框在行间滑动">
        <div className="demo-row">
          <AgentProgress key={`p-open-${k}`} steps={STEPS} stepDuration={2400} />
          <AgentProgress key={`p-min-${k}`} steps={STEPS} stepDuration={2400} defaultMinimized />
        </div>
      </Section>

      <Section title="AgentThinking · 思考状态" note="BoardUI 免费组件，源码内嵌在页面里，直接提取">
        <div className="demo-col">
          <div className="demo-row">
            <AgentThinking variant="wave" label="思考" showTimer />
            <AgentThinking variant="spin" label="搜索文档" showTimer />
            <AgentThinking variant="stars" label="思考" showTimer />
            <AgentThinking variant="infinity" label="思考" showTimer />
          </div>
          <div className="demo-row">
            <AgentThinking variant="wave" label="思考" showTimer={false} shimmer={false} />
            <AgentThinking variant="infinity" label="思考" tone="accent" showTimer />
          </div>
        </div>
      </Section>

      <Section title="ThinkingOrbs · 九种状态" note="MIT 开源的物理粒子引擎，零依赖，size 64">
        <div className="demo-orb-grid">
          {ORB_STATES.map((state) => (
            <div key={state} className="demo-orb-cell">
              <ThinkingOrb state={state} size={64} theme="light" />
              <span>{state}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="ThinkingOrbs · 尺寸与着色" note="20px 是内联文字尺度，64px 是头像尺度">
        <div className="demo-row demo-row-center">
          <div className="demo-orb-cell">
            <ThinkingOrb state="breathing" size={64} theme="light" />
            <span>64</span>
          </div>
          <div className="demo-orb-cell">
            <ThinkingOrb state="breathing" size={32} theme="light" />
            <span>32</span>
          </div>
          <div className="demo-orb-cell">
            <ThinkingOrb state="breathing" size={20} theme="light" />
            <span>20</span>
          </div>
          <div className="demo-orb-cell">
            <ThinkingOrb state="working" size={64} theme="light" color="#3B8CF8" />
            <span>着色</span>
          </div>
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Demo />);
