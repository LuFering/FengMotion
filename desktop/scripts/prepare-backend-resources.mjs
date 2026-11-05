/**
 * 准备打包资源：把后端 jar 与精简 JRE 放到 electron-builder 期望的位置。
 *
 * <p>为什么单独一个脚本而不是写进 electron-builder 配置：这两件事都需要先"构建"
 * （Maven 打包、jlink 裁剪运行时），electron-builder 的 files/extraResources
 * 只能拷贝已存在的文件，不能驱动构建。</p>
 *
 * <p>JRE 用 jlink 裁剪：完整 JDK 约 300MB，而 Spring Boot + SQLite 只需要
 * java.base、java.sql、java.naming、java.management、jdk.unsupported 等几个模块，
 * 裁剪后约 50-60MB。随包分发不裁剪会让安装包大一倍以上。</p>
 *
 * 用法：
 *   node scripts/prepare-backend-resources.mjs
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
/* 单仓两目录：后端在同级的 backend/。合仓前这里是 ../FengMotion-backend，
   目录改名后这条路径失效，打包会以 ENOENT 失败（cwd 不存在时 mvn 也报 ENOENT，
   很容易误判成「mvn 没装」）。 */
const backendDir = path.resolve(repoRoot, '..', 'backend')
const outRoot = path.join(repoRoot, 'electron', 'resources')
const jreDir = path.join(outRoot, 'jre')
const backendOut = path.join(outRoot, 'backend')
/* Remotion 渲染工程与它的运行依赖。
   为什么不依赖 electron-builder 自动收 node_modules：@remotion/bundler 与
   @remotion/renderer 只是 desktop 的传递依赖，没写进 dependencies，
   electron-builder 不会打包 —— 实测发现打包应用里渲染直接失败，
   报「找不到 Remotion 渲染工程」。所以显式拷进 resources。 */
const remotionSrc = path.resolve(repoRoot, '..', 'backend', 'remotion')
const remotionOut = path.join(outRoot, 'remotion')
const remotionModulesOut = path.join(remotionOut, 'node_modules')
/* workflow-v0.1.0 创作工具：agent 的创作依据与校验工具都在这里。
   不随包带上的话，打包应用里后端找不到 workflow 目录，
   「建立创作上下文」直接失败 —— 开发态能跑不代表安装态能跑。 */
const workflowSrc = path.resolve(repoRoot, '..', 'frontend', 'workflow-v0.1.0')
const workflowOut = path.join(outRoot, 'workflow-v0.1.0')
/* ffmpeg / ffprobe：缩略图抽帧与音视频元数据探测。
   不随包带上的话，打包应用里素材页全是占位图标、时长显示「未知」——
   导入不会失败（后端有降级），但体验会明显退化，所以要一起带。

   注意：本机 ffmpeg 是**动态链接**的（依赖 160+ 个 .so）。只拷二进制在别的机器上
   会因缺库而启动失败，因此把 libav / libsw 系列一并放进 ffmpeg/lib，并在启动脚本里
   通过 LD_LIBRARY_PATH 指过去。这不是通用解法 —— 目标机 glibc 版本过旧仍可能起不来，
   那种情况下的表现是「没有缩略图」，不是崩溃，已由后端降级路径兜住。 */
const ffmpegOut = path.join(outRoot, 'ffmpeg')
const REMOTION_RUNTIME_PACKAGES = ['@remotion/bundler', '@remotion/renderer']
/** 与 desktop 使用的 Remotion 版本保持一致；换版本时这里和 desktop 一起改。 */
const REMOTION_VERSION = '4.0.519'

/** 执行一个命令，失败时抛出可读错误。 */
function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

/* ── 1. 构建后端 jar ─────────────────────────────────────── */
function buildJar() {
  const mvn = process.env.FENGMOTION_MVN
    ?? path.join(process.env.HOME ?? '', '.local', 'opt', 'apache-maven-3.9.9', 'bin', 'mvn')
  const mvnCmd = existsSync(mvn) ? mvn : 'mvn'

  console.log('\n[1/5] 构建后端 jar')
  run(mvnCmd, ['-q', 'package', '-DskipTests'], backendDir)

  const target = path.join(backendDir, 'target')
  const jar = readdirSync(target)
    .filter((f) => f.endsWith('.jar') && !f.endsWith('.original'))
    .map((f) => path.join(target, f))
    // 有多个时取最大的（可执行 jar 含依赖，体积明显大于 .original 之外的其它产物）
    .sort((a, b) => statSync(b).size - statSync(a).size)[0]

  if (!jar) throw new Error('没有找到后端 jar，请确认 mvn package 成功')

  rmSync(backendOut, { recursive: true, force: true })
  mkdirSync(backendOut, { recursive: true })
  // 固定名字：electron/backend.ts 按 fengmotion-server.jar 查找，
  // 不跟随 Maven 的版本号命名，避免版本一变就要同步改代码
  cpSync(jar, path.join(backendOut, 'fengmotion-server.jar'))
  console.log(`  已复制 ${path.basename(jar)} → backend/fengmotion-server.jar`)
}

/* ── 2. 裁剪 JRE ─────────────────────────────────────────── */
function buildJre() {
  console.log('\n[2/5] 裁剪 JRE (jlink)')

  const javaHome = process.env.JAVA_HOME
    ?? execFileSync('bash', ['-c', 'dirname $(dirname $(readlink -f $(which java)))'], { encoding: 'utf8' }).trim()
  const jlink = path.join(javaHome, 'bin', 'jlink')
  if (!existsSync(jlink)) {
    throw new Error(`找不到 jlink：${jlink}。请设置 JAVA_HOME 指向 JDK 21（JRE 不含 jlink）`)
  }

  /* 模块清单来自实际运行需要：
     · java.base/java.logging     —— Spring 基础
     · java.sql/java.naming       —— JDBC 与 SQLite（数据源用 JNDI 名字解析）
     · java.management            —— Spring Boot 的指标与 JMX 探测
     · jdk.unsupported            —— 反射/Unsafe，Spring 与若干库依赖
     · java.desktop               —— 字体与图片解码（若不裁剪掉，处理图片会报错）
     · java.instrument            —— Spring AOP 的部分路径
     · jdk.crypto.ec              —— HTTPS（GitHub Releases 检查更新用 TLS） */
  /* 模块清单不能靠猜：漏一个就是启动时 NoClassDefFoundError。
     以下清单由实际启动验证得出 —— 初版漏了 java.security.jgss，
     Tomcat 初始化认证链路立刻失败（org.ietf.jgss.GSSException 找不到）。 */
  const modules = [
    'java.base',            // 语言核心
    'java.logging',         // JUL，Spring 日志桥接
    'java.sql',             // JDBC
    'java.naming',          // JNDI，数据源名解析
    'java.management',      // JMX，Spring Boot 指标
    'java.instrument',      // Spring AOP 部分路径
    'java.desktop',         // 字体/图片解码
    'java.security.jgss',   // Tomcat 认证链路（缺了会 NoClassDefFoundError）
    'java.security.sasl',   // 同上，认证协议族
    'jdk.unsupported',      // Unsafe/反射，Spring 与多个库依赖
    'jdk.crypto.ec',        // TLS 椭圆曲线（检查更新走 HTTPS）
    /* java.net.http —— 语义检索调 DashScope 用的 HttpClient。
       漏了它在安装态是启动即失败：EmbeddingProvider 构造时 NoClassDefFoundError，
       整个后端起不来。开发态用完整 JDK 永远发现不了，只能靠安装验证。 */
    'java.net.http',
  ].join(',')

  // jlink 要求输出目录不存在：它自己会创建。先删干净，不要预建。
  rmSync(jreDir, { recursive: true, force: true })

  run(jlink, [
    '--add-modules', modules,
    '--strip-debug',
    '--no-man-pages',
    '--no-header-files',
    '--compress=zip-6',
    '--output', jreDir,
  ], repoRoot)
}

/* ── 3. Remotion 渲染工程 ─────────────────────────────────── */
function buildRemotion() {
  console.log('\n[3/5] 打包 Remotion 渲染工程')

  /* 只拷 render.mjs 与 src/：.cache 与 .remotion 是本机构建缓存和下载的
     Chromium，几百 MB，且换机器后无效。 */
  rmSync(remotionOut, { recursive: true, force: true })
  mkdirSync(remotionOut, { recursive: true })
  /* 渲染脚本有三个，必须一起带上：
       render.mjs         内置 Film + scenes props
       render-shared.mjs  两者共用流程（依赖解析、可写临时目录、浏览器、输出协议）
       render-project.mjs 项目工程（agent 写的源码）
     只拷 render.mjs 时，开发态因为就在仓库里所以能跑，安装后才报
     renderer_unavailable —— 实测踩到过。改用目录扫描，以后再加脚本不必回来改清单。 */
  for (const file of readdirSync(remotionSrc)) {
    if (file.endsWith('.mjs')) {
      cpSync(path.join(remotionSrc, file), path.join(remotionOut, file))
    }
  }
  cpSync(path.join(remotionSrc, 'src'), path.join(remotionOut, 'src'), { recursive: true })

  /* 依赖用 npm install 装一份完整的，而不是从 desktop/node_modules 逐个拷。
     原因：@remotion/bundler 自身还有大量传递依赖（@remotion/studio-shared、
     esbuild、react 等），手工列举必然漏 —— 实测漏了 studio-shared，
     打包应用渲染报 Cannot find module。unpacked 测试能过是因为它蹭到了
     desktop/node_modules 的完整依赖树，AppImage 里是隔离的，不会侥幸。
     版本锁在这里，避免随 desktop 依赖漂移。 */
  const deps = REMOTION_RUNTIME_PACKAGES.map((p) => `${p}@${REMOTION_VERSION}`)
  const pkgJson = {
    name: 'fengmotion-remotion-runtime',
    private: true,
    version: '0.0.0',
    dependencies: Object.fromEntries(REMOTION_RUNTIME_PACKAGES.map((p) => [p, REMOTION_VERSION])),
  }
  writeFileSync(path.join(remotionOut, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n')
  console.log(`  安装运行依赖：${deps.join(', ')}`)
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], remotionOut)

  const pkgCount = existsSync(remotionModulesOut) ? readdirSync(remotionModulesOut).length : 0
  if (pkgCount === 0) {
    throw new Error(`Remotion 运行依赖安装失败：${remotionModulesOut} 为空`)
  }
  console.log(`  render.mjs + src/ 已复制，运行依赖已安装（顶层包 ${pkgCount} 个）`)
}

/* ── 4. workflow-v0.1.0 创作工具 ──────────────────────────────── */
function buildWorkflowTools() {
  console.log('\n[4/6] 打包 workflow-v0.1.0 创作工具')

  if (!existsSync(workflowSrc)) {
    throw new Error(`找不到 workflow-v0.1.0 目录：${workflowSrc}`)
  }
  rmSync(workflowOut, { recursive: true, force: true })
  /* 只拷工具、模板与说明，不拷 examples（那是校验用的夹具，
     既不参与创作也不该被当成默认题材）。 */
  cpSync(workflowSrc, workflowOut, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}examples${path.sep}`)
      && !src.endsWith(`${path.sep}examples`),
  })
  const initTool = path.join(workflowOut, 'prompt-first', 'tools', 'init-project.mjs')
  if (!existsSync(initTool)) {
    throw new Error(`workflow-v0.1.0 缺少 init-project 工具：${initTool}`)
  }
  console.log('  工具与模板已复制（不含 examples 夹具）')
}

/* ── 5. ffmpeg（缩略图与元数据）─────────────────────────── */
function buildFfmpeg() {
  console.log('\n[5/6] 打包 ffmpeg')

  const candidates = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']
  const ffmpegBin = candidates.find((p) => existsSync(p))
  if (!ffmpegBin) {
    /* 缺 ffmpeg 不阻断打包：后端在找不到 ffmpeg 时仍能导入素材，
       只是没有缩略图、时长显示「未知」。这比让整个安装包打不出来要好。 */
    console.warn('  ⚠ 未找到 ffmpeg，打包应用将没有素材缩略图（导入仍可用）')
    return
  }
  const ffprobeBin = ffmpegBin.replace(/ffmpeg$/, 'ffprobe')
  rmSync(ffmpegOut, { recursive: true, force: true })
  mkdirSync(ffmpegOut, { recursive: true })
  cpSync(ffmpegBin, path.join(ffmpegOut, 'ffmpeg'))
  if (existsSync(ffprobeBin)) cpSync(ffprobeBin, path.join(ffmpegOut, 'ffprobe'))

  /* 动态库：把 ffmpeg 依赖的 libav / libsw 系列一起带上。
     用 ldd 列出真实依赖，只取解码/容器相关的那几个（其余的 libc、libz 等在目标机都有）。 */
  const libDir = path.join(ffmpegOut, 'lib')
  mkdirSync(libDir, { recursive: true })
  let copied = 0
  try {
    const ldd = execFileSync('ldd', [ffmpegBin], { encoding: 'utf8' })
    for (const line of ldd.split('\n')) {
      const m = line.match(/(lib(?:av|sw)[a-z0-9]*\.so[^\s]*)\s+=>\s+(\/\S+)/)
      if (!m) continue
      /* 必须 copyFileSync 而不是 cpSync：系统里的 libavcodec.so.63 是符号链接，
         cpSync 会把**绝对路径的链接**拷进去，安装包里只剩一条指向 /usr/lib/... 的
         死链 —— 目标机没有那个文件，等于没带库。
         （cpSync 加 dereference 也不行：它会把符号链接目标当目录处理并报 EISDIR。
         copyFileSync 默认跟随链接，复制的就是真实内容。） */
      copyFileSync(m[2], path.join(libDir, m[1]))
      copied += 1
    }
  } catch (err) {
    console.warn('  ⚠ 读取 ffmpeg 动态依赖失败，缩略图在目标机可能不可用：' + err.message)
  }
  // 校验：任何一个还是符号链接就说明打包产物在目标机不可用。
  const stillLinks = readdirSync(libDir).filter((f) => {
    try {
      return statSync(path.join(libDir, f)).size === 0
    } catch {
      return true
    }
  })
  if (stillLinks.length > 0) {
    throw new Error(`以下库复制成了空文件或死链，安装包里会失效：${stillLinks.join(', ')}`)
  }
  console.log(`  ffmpeg 与 ${copied} 个 libav/libsw 库已复制`)
}

/* ── 6. 校验 ─────────────────────────────────────────────── */
function verify() {
  console.log('\n[6/6] 校验产物')
  const java = path.join(jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  const jar = path.join(backendOut, 'fengmotion-server.jar')
  if (!existsSync(java)) throw new Error(`JRE 缺少 java 可执行文件：${java}`)
  if (!existsSync(jar)) throw new Error(`后端 jar 缺失：${jar}`)

  const version = execFileSync(java, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  console.log('  JRE:', version.split('\n')[0])
  console.log('  jar:', (statSync(jar).size / 1024 / 1024).toFixed(1) + ' MB')

  const jreSize = execFileSync('du', ['-sh', jreDir], { encoding: 'utf8' }).split('\t')[0]
  console.log('  JRE 体积:', jreSize)

  for (const file of ['render.mjs', 'render-shared.mjs', 'render-project.mjs']) {
    if (!existsSync(path.join(remotionOut, file))) {
      throw new Error(`缺少渲染脚本：${file}（项目工程渲染会失败）`)
    }
  }
  const renderScript = path.join(remotionOut, 'render.mjs')
  const entry = path.join(remotionOut, 'src', 'index.tsx')
  if (!existsSync(renderScript)) throw new Error(`缺少 Remotion 渲染脚本：${renderScript}`)
  if (!existsSync(entry)) throw new Error(`缺少 Remotion 工程入口：${entry}`)
  for (const pkg of REMOTION_RUNTIME_PACKAGES) {
    if (!existsSync(path.join(remotionModulesOut, pkg))) {
      throw new Error(`缺少 Remotion 运行依赖：${pkg}`)
    }
  }
  /* 传递依赖也必须抽查：它们是「打包后渲染失败」的真实原因，
     只检查两个顶层包会漏掉整类问题。 */
  for (const pkg of ['@remotion/studio-shared', '@remotion/studio']) {
    if (!existsSync(path.join(remotionModulesOut, pkg))) {
      throw new Error(`缺少 Remotion 传递依赖：${pkg}`)
    }
  }
  console.log('  Remotion 工程与依赖: 就绪')

  const initTool = path.join(workflowOut, 'prompt-first', 'tools', 'init-project.mjs')
  if (!existsSync(initTool)) throw new Error(`缺少 workflow-v0.1.0 init-project：${initTool}`)
  console.log('  workflow-v0.1.0 工具: 就绪')

  const ffmpegBin = path.join(ffmpegOut, 'ffmpeg')
  if (existsSync(ffmpegBin)) {
    // 实测跑一次，确认这个二进制在打包环境里真的能执行（动态库齐不齐）。
    try {
      const v = execFileSync(ffmpegBin, ['-version'], { encoding: 'utf8' })
      console.log('  ffmpeg:', v.split('\n')[0])
    } catch {
      console.warn('  ⚠ ffmpeg 已复制但无法执行，缩略图将不可用')
    }
  } else {
    console.warn('  ⚠ 未打包 ffmpeg（缩略图不可用，导入仍可用）')
  }
}

buildJar()
buildJre()
buildRemotion()
buildWorkflowTools()
buildFfmpeg()
verify()
console.log('\n打包资源已就绪：electron/resources/')
