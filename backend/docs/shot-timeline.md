# 镜头装配 · 首次创作试点

新项目可显式选用镜头装配格式。现有项目不迁移，默认创作路径和 `/workflow/create` 保持原样。

## 启用方式

初始化项目创作上下文后，向 `POST /api/projects/{projectId}/creation-jobs` 提交：

```json
{
  "requestId": "unique-request-id",
  "intent": "制作一条有两段镜头的咖啡因科普短片",
  "baseVersion": 0,
  "filmFormat": "shot-timeline-v1"
}
```

复用现有作业轮询、请求幂等和出片响应。只接受没有场景版本的新项目；不识别的 `filmFormat` 不接单。选用此格式后，无合法镜头清单不能改用旧入口提交。Agent 未改工程时仍可返回 `awaiting_info`。

## 工程契约

```json
{
  "format": "shot-timeline-v1",
  "width": 960,
  "height": 540,
  "fps": 30,
  "shots": [
    { "id": "chart", "sourceId": "caffeine-chart", "label": "咖啡因对比", "frames": 120 },
    { "id": "outro", "sourceId": "coffee-outro", "label": "片尾", "frames": 90 }
  ],
  "voiceover": "voiceover.m4a"
}
```

- 写入 `film.config.json`；镜头文件为 `src/shots/<sourceId>.tsx`，命名导出 `Shot`，自行负责视觉样式，不注册合成。镜头的 `id` 是实例 ID，同一个 `sourceId` 可以被多次实例化。不用 `entry`、`compositionId` 或 `startFrame`；后端按帧长累加起点，不接受空槽和叠化。
- 画布宽高为 2–3840 的偶数，帧率为 1–60 的整数；1–60 个镜头、总时长不超过 10 分钟。组件和旁白须存在，不能使用符号链接。`voiceover` 可省略，只接受 `public/voiceover.wav`、`.mp3` 或 `.m4a`；音频交给后端总装，不放进镜头组件。本轮只校验路径以及实际渲染能否读取，不判断配音语义或节拍是否正确。
- 渲染从源码快照开始，固定合成 `FengMotionShots`；`.fengmotion-shot-entry.tsx` 只生成在渲染临时目录。提交后历史版本的 `film.shotTimeline` 保存解析后的清单，轨道用 `shot.id` 作片段 ID。清单和旁白都在正常快照和指纹范围内；旧轨道恢复接口也能从该快照重建轨道。
- 渲染规格不匹配、编译失败或版本冲突时不提交新场景；正常失败路径清理未提交的快照和视频。Agent 写入项目的工作稿可留作修正，不当作成片版本。

## 当前边界

试点实现的是**首次生成契约与受校验的全片装配**。它不是执行沙箱，也不信任单靠提示词就能限制镜头的运行影响。目前生产接口尚不支持单镜头试渲、批准后提交或逐包沿用旁白；这些仅在[独立替换样例](audits/shot-replacement-pilot.md)中完成验证。团队下一步可用稳定镜头 ID 接入版本化候选稿；不要从现有全片重新渲染推断未改片段能逐帧一致。

2026-11-20 隔离服务用预置组件走真实 HTTP 渲染：视频 210 帧、7.000 秒，有声 AAC 流约 7.061 秒。镜头边界以视频帧为准，不用 MP4 容器或 AAC 尾部时长推断。版本记录、稳定轨道、快照恢复和错误拒绝均通过；异步作业分流和幂等由测试替身验证，未执行真实模型生成。
