/**
 * Electron 打包配置（electron-builder）。
 *
 * <p>设计要点：把后端 jar 与裁剪过的 JRE 作为 extraResources 放进安装包，
 * 用户装上就能用 —— 不需要自己装 Java，也不需要开终端跑后端。</p>
 *
 * <p>与现有 install-desktop.mjs 的关系：那个是「本机开发安装」（复用系统 Electron，
 * 增量 rsync）；这份配置产出的是「可分发的安装包」（自带运行时，能给别人用）。
 * 两者并存，不互相替代。</p>
 */
export default {
  appId: 'com.fengmotion.desktop',
  productName: 'FengMotion',
  directories: {
    // 打包前先跑 prepare-backend-resources.mjs 把 jar 与 JRE 放到 electron/resources
    output: 'release',
    buildResources: 'build',
  },
  // 只打包壳代码与前端产物；源码、脚本、node_modules 里无关的部分都排除
  files: [
    'electron/build/**/*',
    'dist/**/*',
    'package.json',
    '!**/*.map',
  ],
  extraResources: [
    // 后端运行时：主进程按 resources/jre 与 resources/backend 查找（见 electron/backend.ts）
    { from: 'electron/resources/jre', to: 'jre' },
    { from: 'electron/resources/backend', to: 'backend' },
    /* Remotion 渲染工程与运行依赖。不加这条时，打包应用能理解用户要求，
       但一渲染就报 renderer_unavailable —— 实测确认过。
       @remotion/bundler 与 renderer 只是传递依赖，不会被自动收进 asar，
       所以由 prepare-backend-resources.mjs 显式拷到 electron/resources/remotion。 */
    { from: 'electron/resources/remotion', to: 'remotion' },
    /* workflow-v5 创作工具。缺了它，后端定位不到 workflow 目录，
       界面的「建立创作上下文」会直接报 workflow_unavailable。
       这些工具是零依赖 .mjs，只需随包带上，不需要额外装依赖。 */
    { from: 'electron/resources/workflow-v5', to: 'workflow-v5' },
  ],
  /* electron-builder 无论如何都会排除 node_modules（它假定依赖由自己管理），
     但 remotion/node_modules 是给渲染脚本用的、不参与打包期依赖解析。
     所以用 afterPack 在打包完成后直接拷进去 —— 不跟它的排除规则较劲。 */
  afterPack: async (context) => {
    const { cpSync, existsSync } = await import('node:fs')
    const path = await import('node:path')
    const from = path.resolve('electron', 'resources', 'remotion', 'node_modules')
    const to = path.join(context.appOutDir, 'resources', 'remotion', 'node_modules')
    if (!existsSync(from)) {
      console.warn('[afterPack] 未找到 remotion 运行依赖，渲染可能不可用：' + from)
      return
    }
    cpSync(from, to, { recursive: true })
    console.log('[afterPack] 已复制 remotion 运行依赖 -> ' + to)
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    category: 'AudioVideo',
    icon: 'build/icons',
    // AppImage 走 differential 更新需要固定的 artifact 命名
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
  // 更新源：GitHub Releases。
  // publish 只声明「更新从哪里取」，不上传 —— 上传由 npm run release 显式触发，
  // 避免本地打包时误发布。
  publish: [
    {
      provider: 'github',
      owner: 'LuFering',
      repo: 'FengMotion',
    },
  ],
  // 差分更新：AppImage 支持 blockmap 增量，只下载变化的块而不是整包
  generateUpdatesFilesForAllChannels: false,
  compression: 'maximum',
}
