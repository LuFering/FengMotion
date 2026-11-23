# 我的素材重做 · 2026-11-21

状态：已实施并完成下述验证，待用户视觉验收。并非将本轮设计标记为用户已认可。

- 方案：[我的素材重做方案](../../design/我的素材重做方案-2026-11-21.md)
- 契约：[素材界面与现有后端](../../contracts/assets-ui.md)
- 页面：开发服务 `http://127.0.0.1:5173/?view=assets`，React 主前端。

## 本轮结果

页面改为标题/搜索/导入、分类侧栏、浏览区筛选、素材网格或列表、按需详情。图片完整显示，名称与元信息移至独立区域；按工作台灰阶、蓝色操作、轻边框和中文字号建立层级。来源、引用项目、授权审核、标签可展开；文件夹位置提前。

修复浏览写入最近使用、重复导入卡片、类型统计与范围不一致、名称 Enter/blur 双提交、Escape 取消输入时连带关闭详情、达到待发送上限却提示已存在等问题。新增导入序号/失败原因/重试、当前文件夹导入、媒体失败反馈、不可用素材禁用新增待发送。已有文件夹、批量更新和参考片登记能力沿用当前接口。

## 截图口径

| 文件 | 数据与状态 |
|---|---|
| before-dark-1440.png | 修改前，真实本机三项素材，1440×900 |
| after-dark-1440.png / after-light-1440.png / after-tactile-1440.png | 修改后，同一真实素材库，三主题，1440×900 |
| detail-dark-1440.png | 真实图片详情打开，1440×900 |
| real-1024.png / real-768.png / real-390.png | 真实库，1024×768、768×800、390×844 |
| fixture-dark-1440.png / fixture-list.png | 浏览器内存夹具，所有条目标演示，覆盖五种类型和长名称 |
| fixture-768.png / fixture-390.png | 上述演示夹具，窄窗布局 |
| selection-768.png / selection-390.png | 演示夹具多选操作条 |
| detail-768.png / detail-390.png | 窄屏原生对话框，背景不可交互、焦点循环与关闭恢复 |
| empty.png / error.png | 浏览器拦截的空库和服务失败 |

`fixture-*` 的图像使用项目已有预览帧，只验证 UI，不代表这些示例文件名与项目内容的真实归属。真实库截图流程监测素材 PATCH 为 0；写操作回归全部由 Playwright route 在内存中处理，未写入用户真实素材。

## 检查

- `npm run build`：通过，现有依赖打包提示仍存在。
- `npx oxlint src/features/assets`：无错误，4 条已有 warning（AssetIcon/PendingAssets 导出、useAssetLoad/useAssetMigration effect 依赖）。
- `node --test tests/pending-deliverable.test.mjs tests/http-multipart.test.mjs`：6/6 通过。
- `node tests/assets-ui.mjs`：32 项通过，详见 `browser-checks.json`。含部分删除引用保护、207 失败、导入重试、24 项容量限制、键盘及窄屏详情焦点保持/恢复、加载失败未知计数。
- `node tests/assets-capture.mjs`：真实库三主题和窄窗截图；1024/768/390 无页面横向溢出。
- Impeccable 机械检测：无发现。
- 全仓 `npm run lint`：失败位置为已有 `public/leibox-composer/composer-engine.js` 压缩文件的 Hooks 检测错误，不属于本轮修改。

浏览器脚本需要当前环境已有的 Playwright 1.65.1 和 Chromium。Playwright 在本机为 extraneous 安装项；未改项目依赖。复现可临时安装 `npm install --no-save --package-lock=false playwright@1.65.1`，再 `npx playwright install chromium`，并启动 Vite；也可用 `UI_BASE` 指定已有开发服务。

## 验证边界

前端构建、只读真实数据与浏览器内存回归已验证。没有重打 Electron 安装包；没有本轮新增后端接口；未在用户真实素材上执行改名、删除或批量管理验收。真实音频解码、字体加载和参考片登记端到端未重新验收，界面继续调用现有实现。素材库仍采用全量分页加载，小型本地素材库适用；大规模库服务端查询/虚拟列表另行设计。

## 独立复核修正

四项修正已落实并重验：主按钮与 hover 白字对比 5.51:1 / 6.44:1；图片透明区域采用中性棋盘底；窄屏详情改用原生 modal dialog；服务读取失败显示未知数量。独立复审 disposition: ship，四项均 resolved；该结论只覆盖四项修复，不代替用户视觉验收。
