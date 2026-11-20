# 镜头候选稿契约

状态：后端已实现版本化预览与确认提交（2026-11-20）。这是镜头装配工程的后端能力，前端只负责候选列表、预览播放器和确认/放弃操作。

## 生成候选预览

`POST /api/projects/{projectId}/scene/versions/{version}/shot-candidates`

请求体：

```json
{
  "baseVersion": 4,
  "sourceHash": "files=8;sha256=...",
  "shotId": "chart",
  "componentSource": "export const Shot = () => ...",
  "prompt": "把柱状图改成排名卡片",
  "requestId": "uuid"
}
```

后端要求 `baseVersion` 等于路径版本和项目当前版本，`sourceHash` 等于该版本的源码快照和当前工作区指纹。`shotId` 必须属于当前镜头清单；只能提交组件源码，不允许在请求中修改时长、起止帧、旁白、画布或其他镜头。组件会写入隔离候选目录并实际渲染，不写工作区、不推进 `project_scenes`。

成功返回：

```json
{
  "projectId": "...",
  "candidateId": "uuid",
  "baseVersion": 4,
  "sourceHash": "files=8;sha256=...",
  "shotId": "chart",
  "sourceId": "fm-candidate-...",
  "previewUrl": "/api/projects/.../scene/versions/4/shot-candidates/uuid/preview",
  "durationInFrames": 120,
  "width": 960,
  "height": 540,
  "fps": 30,
  "hasVoiceover": true
}
```

同一 `requestId` 和相同请求重复提交会复用已完成候选，不会重复渲染；同一 ID 携带不同源码或参数返回 `409 candidate_request_conflict`。

## 读取预览

`GET /api/projects/{projectId}/scene/versions/{version}/shot-candidates/{candidateId}/preview`

返回 `video/mp4`，不缓存。候选预览清单绑定候选文件和视频 SHA-256，文件被替换或清单缺失时拒绝读取。候选目录在项目 `.fengmotion/shot-candidates/` 下，后端会清理超过 7 天的未提交候选。

## 确认提交

`POST /api/projects/{projectId}/scene/versions/{version}/shot-candidates/{candidateId}/commit`

这是唯一会修改项目的动作。后端重新校验当前版本、工作区指纹、候选源码哈希和镜头清单，然后从版本快照重新装配并渲染完整成片。通过后才：

1. 原子替换工作区的镜头组件和 `film.config.json`；
2. 保存新的源码快照、视频和轨道清单；
3. 以条件版本写入新的场景版本，`source = shot_edit`；
4. 记录候选 ID，重复确认返回同一个已提交版本，不重复推进版本号。

预览成功不代表已提交。渲染失败、版本冲突、源码变化或提交失败都不会推进版本；提交失败会清理新的成片和快照，并恢复工作区。候选预览仍可重试提交。旧版本、其他镜头和旁白不会被覆盖。

## 放弃候选

`DELETE /api/projects/{projectId}/scene/versions/{version}/shot-candidates/{candidateId}` 返回 `204`。它只删除未提交候选；已提交候选返回 `409 shot_candidate_already_committed`，保留幂等元数据。

## 支持范围

- 只支持 `shot-timeline-v1` 镜头装配工程和硬切镜头。
- 目标镜头必须存在且由版本清单定义；组件需要导出名为 `Shot` 的 Remotion 组件。
- 候选预览默认只渲染目标镜头；有旁白时截取目标帧区间生成局部预览音轨。
- 确认阶段重新渲染完整镜头装配，沿用未修改镜头和旁白的源码/资源，不对跨镜头转场作假设。
- 这是受控的源码入口，不是任意 Agent 代码沙箱；正式开放不受信代码前仍需补进程、文件系统、依赖和网络隔离。

错误码重点：`scene_version_conflict`、`source_version_conflict`、`working_source_conflict`、`shot_edit_unavailable`、`shot_candidate_changed`、`shot_render_mismatch`、`render_failed`。客户端遇到版本或指纹冲突必须重新读取当前版本，不能自动覆盖。
