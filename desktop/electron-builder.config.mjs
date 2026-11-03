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
  ],
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
