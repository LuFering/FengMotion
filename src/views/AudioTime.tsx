/**
 * 时序校验 —— 音频示范复刻页（已融入壳层 + 数据适配到 FengMotion 真实数据）。
 *
 * 用户提供的自包含单文件复刻（dub-editor-v8.html）放在 public/replica/ 下，
 * 用 iframe 原样装载，接线方式与创作资产页（.acr → sonora-ss25.html）一致。
 *
 * 两层注入都打 `fm-adapt` 标注（原展示形态保留在 attachments 原件里）：
 *  - 适应层：满幅贴内容区（去展示白边/圆角/阴影）、真实项目名经 ?project= 注入、
 *    返回键 postMessage('fm-audio-back') → 壳层 openList()、未接入能力灰显注明。
 *  - 数据层：bundle 内示范数据 → FengMotion 真实数据（数值由 src/data 现算写死）：
 *    视频 = /media/token-full-legacy.mp4（152s，真播真跳）；转写 25 条 = 成片剪辑
 *    （状态色 + 旁白 + 段/字数/需给/超 读数，未映射的如实标注）；时间轴 0→2:32
 *    真实刻度与片段位置；警告 58 = 2 空档 + 1 重叠 + 55 口播会超（4.5 字/秒）；
 *    成片无音频流 → 假波形撤掉，如实说明。「定位第一处空档」「复制差异清单」
 *    是真动作（经 window.__fmMonitor 的秒数 API 与剪贴板）。
 *    ⚠️ 真实数据改自 src/data/{activeFilm,productionData,voiceTiming,timeline}.ts，
 *    那边更新后要重跑提取脚本刷新这份字面量。
 */
export function AudioTime({ projectName }: { projectName?: string } = {}) {
  const name = projectName ?? 'FengMotion'
  const src = `/replica/dub-editor-v8.html?project=${encodeURIComponent(name)}`
  return (
    <div className="atr" data-project={name}>
      <iframe
        className="atr-frame"
        src={src}
        title="时序校验复刻（Dub Editor）"
      />
    </div>
  )
}
