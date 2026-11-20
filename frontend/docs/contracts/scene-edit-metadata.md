# 契约 · 工程版本的元素声明

状态：后端已实现按版本读取声明与文字写回（2026-11-20）。前端点选、属性面板和交互状态由独立前端实现；后端不解析像素，也不运行工作台里的 TSX 来猜测元素。

## 读取元素

`GET /api/projects/{projectId}/scene/versions/{version}/edit-metadata`。`version` 是场景版本号，不是工作流 revision。响应不缓存（`Cache-Control: no-store`）。

| 状态 | 含义 |
|---|---|
| HTTP 200，`status: declared` | 指定版本的源码快照和声明通过校验。`sourceHash` 为该快照的指纹，`elements` 为声明的元素，`reason` 为 `null`。 |
| HTTP 200，`status: preview_only` | 此版本不能提供元素声明。`sourceHash` 为 `null`，`elements` 为空；`reason` 含稳定 `code` 和说明 `message`。此状态不替代视频可用性检查。 |
| HTTP 404，`error.code: not_found` | 项目或指定版本不存在。只有文件、没有版本记录时也不能查询此接口。 |

两种成功状态均返回 `projectId`、`version`、`artifactPath`（该版本登记的相对视频路径，可为 `null`）。读取不检查视频是否仍可播放，播放仍走产物读取接口。

`preview_only` 的原因：

| `reason.code` | 触发条件 |
|---|---|
| `unsupported_source` | 版本没有 `project-render` 来源，例如旧场景 JSON。 |
| `snapshot_missing` | 缺少项目根目录、快照引用或版本指纹。 |
| `snapshot_invalid` | 快照不可读、指纹不符、包含符号链接，或工程入口、合成与版本记录不一致。 |
| `manifest_missing` | 有可校验的快照，但当时未保存元素声明。 |
| `manifest_invalid` | 声明不合法、超出限制或不可读取。 |

## 修改文字

文字写回使用 `POST /api/projects/{projectId}/scene/versions/{version}/edit`，请求体必须带上正在编辑的版本和源码指纹：

```json
{
  "baseVersion": 4,
  "sourceHash": "files=3;sha256=...",
  "elementId": "intro-title",
  "properties": { "text": "新的标题" },
  "prompt": "把片头标题改短"
}
```

成功返回 `200` 和新版本的基本信息：

```json
{
  "projectId": "...",
  "version": 5,
  "artifactPath": "renders/project-element-....mp4",
  "sourceHash": "files=3;sha256=...",
  "elementId": "intro-title",
  "properties": { "text": "新的标题" }
}
```

路径 `version` 必须等于 `baseVersion`，且只能修改项目当前版本。`prompt` 可省略，仅用于历史说明，最长 4000 个 UTF-16 代码单元，不交给模型执行。

接口同步等待渲染和提交，不返回后台任务 ID。后端从修改后的独立快照渲染，保存视频和轨道，复核工作区指纹后原子替换工作区里的声明，并条件提交新版本（`source: element_edit`）。下一次普通渲染会使用新文字。旧版本、旧快照及旧视频不会被覆盖。

写回目前只支持 `kind: text` 的 `properties.text`，长度上限与声明相同为 2000 个 UTF-16 代码单元。图片、形状、音频、未知属性、旧版本、错误指纹和没有有效声明的版本均拒绝，不会启动渲染。

| HTTP | `error.code` | 调用方处理 |
|---|---|---|
| 400 | `validation_error`、`unsupported_element_property`、`element_edit_noop` | 校验请求；只提交确实改变的文字。 |
| 404 | `not_found`、`element_not_found` | 项目或元素不存在；重新读取。 |
| 409 | `scene_not_initialized`、`scene_version_conflict`、`source_version_conflict` | 重新读取当前版本和声明，不复用旧基线。 |
| 409 | `working_source_conflict` | 源码工作稿与基线不一致，保留工作稿；先渲染工作稿并以新版本为基线。 |
| 409 | `project_busy` | 等待同项目操作结束，重新读取版本。 |
| 422 | `element_edit_unavailable`、`source_snapshot_unavailable`、`snapshot_corrupt`、`manifest_invalid` | 快照或声明不能支持这次编辑，不降级成其他修改。 |

渲染或提交失败不登记本次版本；服务尝试清理未提交的视频、轨道和快照。数据库提交失败时恢复本次写入的声明；恢复失败返回 `manifest_rollback_failed`。项目锁只协调同进程操作，文件系统与数据库之间没有崩溃级原子事务。客户端超时后先查询当前版本，不能假定服务端已经停止渲染。

## 工程声明

让组件直接用 `src/editable-elements.json` 中的值绘制标题。例如，组件以 `intro-title` 查找 `properties.text`，并按同一份 `placement` 确定标题在成片中的位置和显示区间，避免分别维护画面与声明。

```json
{
  "schemaVersion": 1,
  "elements": [
    {
      "id": "intro-title",
      "kind": "text",
      "label": "片头标题",
      "properties": { "text": "一杯咖啡里有多少咖啡因？" },
      "placement": {
        "startFrame": 0,
        "endFrame": 90,
        "bounds": { "x": 0.1, "y": 0.12, "w": 0.8, "h": 0.18 }
      }
    }
  ]
}
```

声明和 `src/` 一起进入现有渲染快照，参与源码指纹计算。查询读取的是指定版本的快照，不使用当前工作目录、其他版本或轨道清单补全数据。已有版本不回填；新增声明需要出新的工程版本才会进入其快照。

格式限制：最大 64 KiB，1 至 64 个元素，`id` 在声明中唯一并匹配 `[a-z][a-z0-9_-]{0,63}`；`kind` 只接受 `text`，`label` 非空且最多 80 个 UTF-16 代码单元，`properties` 只接受字符串 `text`（可为空，最多 2000 个 UTF-16 代码单元）。拒绝重复 JSON 键、额外字段、尾随 JSON 和未支持的声明版本。单项无效时整份不返回。

`placement` 可省略；没有位置的元素仍可读取，但不能点选。它必须包含相对成片的整数帧区间 `[startFrame, endFrame)`，其中 `0 ≤ startFrame < endFrame ≤ output.durationInFrames`，以及归一化画布坐标 `bounds`。`x/y/w/h` 分别在 `[0, 1]` 内，`w`、`h` 大于零，整个矩形必须在画布内。声明的区间应只覆盖标题固定可见的帧；动态位置、挡住标题的画面和透明过场不可沿用静态边界。

## 前端点选边界

前端可以核对项目、场景版本、产物路径与源码指纹，并使用声明中的 `placement` 实现画面命中。后端只负责声明归属、版本基线和修改提交，不规定播放器上的按钮、覆盖层或属性面板样式，也不把时间轨道当作元素命中结果。

前端应在视频暂停、目标帧位于 `placement.startFrame` 到 `endFrame` 且画布矩形命中时展示自己的属性面板；提交时把读取到的 `version` 和 `sourceHash` 原样带回写回请求。版本切换或提交成功后，应以返回的新版本重新读取声明和视频。

`declared` 证明声明属于这个版本的源码快照且字段合法，不能证明代码实际绘制了该元素或静态边界覆盖了文字。写回只修改声明，因此组件必须实际使用该声明的值，否则视频画面不会随之改变。

实现入口见 [SceneEditMetadataService](../../../backend/src/main/java/com/fengmotion/server/project/service/SceneEditMetadataService.java) 和 [SceneElementEditService](../../../backend/src/main/java/com/fengmotion/server/creation/service/SceneElementEditService.java)，版本隔离、回滚和写回行为见 [SceneEditMetadataApiTest](../../../backend/src/test/java/com/fengmotion/server/project/api/SceneEditMetadataApiTest.java) 与 [SceneElementEditApiTest](../../../backend/src/test/java/com/fengmotion/server/project/api/SceneElementEditApiTest.java)。
