# 契约 · skill 包导入与静态清点

状态：**已实现，待前端接入**（2026-11-18）。
范围：从 GitHub 导入 AI Coding Agent 的 skill 包，按固定 commit 只读落盘，并输出静态清点报告。AI 分析、生成预设、组件验证入库不在本契约内。
路径：后端实际挂在 `/api`，不是总则里的 `/api/v1`。

## 1. 安全边界

- **不执行**：后端不启动任何外部进程，不运行包内脚本，也不运行 `npm install`。落盘文件权限为 `r--r--r--`，不可写、不可执行。
- **只访问 GitHub**：后端只请求 `api.github.com`（把 ref 解析成 commit）和 `codeload.github.com`（按 commit 下载 zip），不跟随重定向。
- **固定 commit**：ref 只在导入时解析一次，之后一律使用 40 位 SHA。
- **解压防线**：条目名含 `..`、绝对路径、反斜杠时拒绝。大小按实际解压字节计算：总量 50MB，单个文件 10MB，最多 5000 个文件。超限即整体失败，不留下半成品。
- **令牌**：可选环境变量 `FENGMOTION_GITHUB_TOKEN`，用于私有仓库或突破未登录限额（每小时 60 次）。令牌不写入日志、响应或报告。

## 2. SkillPackage

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 包 ID |
| `owner` / `repo` | string | GitHub owner 与仓库名，统一小写 |
| `requestedRef` | string \| null | 导入时请求的分支 / 标签 / commit；`null` 表示默认分支 |
| `commitSha` | string | 实际固定的 40 位 commit |
| `subPath` | string | 只导入的子目录；`""` 表示整个仓库 |
| `rootDir` | string | 落盘目录（本机绝对路径） |
| `fileCount` / `totalBytes` | number | 文件数与总字节数 |
| `report` | SkillInventory \| null | 清点报告；列表接口为 `null` |
| `importedAt` | ISO 8601 | 导入时间 |

同一 `owner/repo/commitSha/subPath` 只登记一份。

## 3. SkillInventory（清点报告，`version: 1`）

| 字段 | 说明 |
|---|---|
| `skills[]` | 每个 `SKILL.md` 一项：`path`、`directory`、`name`、`description`、`frontmatter`（原样保留全部字段）、`frontmatterError`（解析失败原因，成功为 `null`） |
| `files[]` | 每个文件一项：`path`、`size`、`sha256`、`category`、`imports`（仅代码文件，否则为 `null`） |
| `scripts[]` | 脚本：`kind` 为 `file`（扩展名或 shebang）或 `npm-script`（package.json scripts）。**全部未执行** |
| `instructedCommands[]` | SKILL.md 要求运行的命令（shell 代码块里的行，以及以常见运行器开头的行内代码），需要人工批准 |
| `dependencies` | `declared`（package.json 声明的依赖，含 dev / peer / optional）、`used`（代码实际 import 的 npm 包）、`undeclared`（用到却没有声明）、`remotionPackages`、`approximate`（恒为 `true`） |
| `license` | `spdx`（按许可证文件内容识别；认不出时取 package.json 的值，否则为 `unknown`）、`files`、`packageJsonLicense` |
| `warnings[]` | 例如没有 SKILL.md、frontmatter 缺失或格式错误、文件过大未解析 |
| `summary` | `skills`、`files`、`totalBytes`、`categories`、`scripts`、`unresolvedImports` |

`category` 取值：`skill` / `doc` / `component` / `code` / `script` / `config` / `asset` / `other`。首行是 shebang 的文件一律算 `script`。

`imports[].kind` 取值：

- `relative`：`resolved` 是包内路径，对应不到文件时为 `null`；
- `package`：`resolved` 是包名，例如 `@remotion/player/x` 归为 `@remotion/player`；
- `builtin`：Node 内置模块；
- `alias`：按离文件最近的 `tsconfig.json` 中的 `compilerOptions.paths` 解析，解析不了时为 `null`。

import 依赖靠正则提取，是**近似结果**：注释里的 import 可能被多算，拼接出来的模块名会漏算。

报告格式字段只增不改义；需要改变含义时升级 `version`。

## 4. 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/skill-packages/import` | 请求体 `{ repository, ref?, path? }`，返回 `{ reused, skillPackage }` |
| `GET` | `/api/skill-packages` | 列表，按导入时间倒序，不含 `report` |
| `GET` | `/api/skill-packages/{id}` | 详情，含完整报告 |
| `DELETE` | `/api/skill-packages/{id}` | 删除登记与落盘文件，返回 `204`；之后可以重新导入 |

`repository` 支持 `owner/repo`，或 `https://github.com/owner/repo`（可带 `.git` 后缀，也可带 `/tree/<ref>/<path>`）。地址里的 ref 只取一段，带斜杠的分支名请用 `ref` 字段单独传。`ref`、`path` 字段的优先级高于地址里的值。

导入是同步的，下载最长 60 秒。

## 5. 错误

| HTTP | code | 场景 |
|---|---|---|
| 400 | `validation_error` | 缺请求体或仓库；非 `https://github.com` 地址；owner、repo、ref、path 格式不对，或含 `..` |
| 404 | `not_found` | 仓库、ref、子目录或包不存在；私有仓库没有配置令牌也是这个错误 |
| 413 | `package_too_large` | 超过总量、单文件或文件数上限 |
| 422 | `package_unsafe` | 压缩包里有不安全的路径 |
| 502 | `upstream_unavailable` | GitHub 不可用、限流或返回损坏的压缩包 |
| 500 | `skill_import_failed` / `skill_delete_failed` | 本机文件读写失败 |
