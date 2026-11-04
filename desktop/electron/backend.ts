/**
 * 后端进程管理：随桌面应用一起启动 Spring Boot 后端。
 *
 * <p><strong>为什么由壳来管</strong>：把后端打进应用后，用户不该再自己开终端跑
 * `mvn spring-boot:run`。壳负责启动它、等它就绪、退出时收掉它 —— 应用关掉后
 * 不该留一个占着端口的 Java 进程。</p>
 *
 * <p><strong>Java 从哪来</strong>：应用自带 JRE（随包分发），所以不依赖用户机器上
 * 装没装 Java。开发态（未打包）优先用 `JAVA_HOME` 或系统 `java`，方便直接跑源码。</p>
 *
 * <p><strong>端口</strong>：优先 8080，被占用则向系统要一个空闲端口。硬编码会让
 * 「端口冲突」直接变成「应用打不开」，而用户完全无法自己解决。</p>
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync, readdirSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/** 后端进程句柄与它实际监听的地址。 */
export interface BackendHandle {
  /** 实际使用的端口 */
  readonly port: number
  /** 前端的 API 基址，例如 http://127.0.0.1:8080/api */
  readonly apiBase: string
  /** 停止后端（幂等） */
  stop(): Promise<void>
  /** 是否仍在运行 */
  alive(): boolean
}

/** 启动参数。 */
export interface StartOptions {
  /** 应用资源根目录（打包后是 process.resourcesPath，开发态是仓库根） */
  resourcesRoot: string
  /** 用户数据目录：数据库与附件都放这里 */
  dataDir: string
  /** 日志文件路径；空则丢弃输出 */
  logFile?: string
}

/**
 * 找一个空闲端口。
 *
 * @param preferred 期望端口；被占用时退回系统分配的临时端口
 * @returns 可用端口号
 */
async function findFreePort(preferred: number): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<boolean>((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => server.close(() => resolve(true)))
      server.listen(port, '127.0.0.1')
    })

  if (await tryPort(preferred)) return preferred
  // 期望端口不可用：让系统分配一个，避免应用完全打不开
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0
      server.close(() => resolve(port))
    })
  })
}

/**
 * 定位可执行文件：打包态用自带 JRE 与 jar，开发态退回系统 java + 源码。
 *
 * @param resourcesRoot 资源根目录
 * @returns java 可执行文件与 jar 路径；找不到 jar 时 jar 为 null
 */
function locateRuntime(resourcesRoot: string): { java: string; jar: string | null } {
  const bundledJava = path.join(resourcesRoot, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java')

  /* jar 的候选路径分两种形态：
     · 打包态：resources/backend/fengmotion-server.jar（由打包脚本改名拷入）
     · 开发态：后端 Maven 的 target/*.jar（文件名带版本号，需要按目录找）
     逐个探测，取第一个存在的 —— 硬编码单一路径会让开发态永远起不来。 */
  const candidates = [
    path.join(resourcesRoot, 'backend', 'fengmotion-server.jar'),
    path.join(resourcesRoot, 'fengmotion-server.jar'),
    /* 开发态 resourcesRoot 指向后端仓库根，jar 在 target/ 下（文件名带版本号）。
       下面那段 readdirSync 会把它找出来。 */
    path.join(resourcesRoot, 'target', 'fengmotion-server.jar'),
  ]
  // 开发态：target/ 下的 jar 文件名带版本号，需要按目录扫描
  for (const dir of [resourcesRoot, path.join(resourcesRoot, 'target')]) {
    try {
      const entries = readdirSync(dir).filter(
        (f) => f.endsWith('.jar') && !f.endsWith('.original'),
      )
      for (const f of entries) candidates.push(path.join(dir, f))
    } catch { /* 目录不存在就算了 */ }
  }

  const jar = candidates.find((p) => existsSync(p)) ?? null

  const java = existsSync(bundledJava)
    ? bundledJava
    : (process.env.JAVA_HOME
        ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
        : 'java')

  return { java, jar }
}

/**
 * 轮询后端健康检查，直到就绪或超时。
 *
 * @param apiBase API 基址
 * @param timeoutMs 超时毫秒
 * @returns 是否在超时前就绪
 */
async function waitForHealthy(apiBase: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(1200) })
      if (res.ok) return true
    } catch {
      // 还没起来，继续等
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

/**
 * 启动后端。
 *
 * @param options 启动参数
 * @returns 后端句柄；jar 不存在或启动失败时返回 null（应用仍可用前端，只是没有 Agent）
 */
export async function startBackend(options: StartOptions): Promise<BackendHandle | null> {
  const { java, jar } = locateRuntime(options.resourcesRoot)
  if (jar === null) {
    console.warn('[backend] 未找到后端 jar，跳过启动（前端仍可用）')
    return null
  }

  mkdirSync(options.dataDir, { recursive: true })
  const port = await findFreePort(8080)
  const apiBase = `http://127.0.0.1:${port}/api`

  /* 日志写到数据目录而不是继承 stdout：打包后的应用没有终端，
     继承的输出会丢失，出问题时完全无从排查。 */
  let logFd: number | undefined
  if (options.logFile) {
    try {
      logFd = openSync(options.logFile, 'a')
    } catch {
      logFd = undefined
    }
  }

  /* Remotion 渲染工程与依赖：打包态在 resources/remotion，
     开发态直接指后端仓库里的那份（避免拷来拷去）。
     不传的话后端只能按 user.dir 猜，打包后必然猜不到 —— 实测会报
     renderer_unavailable「找不到 Remotion 渲染工程」。 */
  const remotionDir = path.join(options.resourcesRoot, 'remotion')
  const remotionModules = path.join(remotionDir, 'node_modules')
  const remotionArgs: string[] = []
  if (existsSync(path.join(remotionDir, 'render.mjs'))) {
    remotionArgs.push(`--fengmotion.remotion.project-dir=${remotionDir}`)
    if (existsSync(remotionModules)) {
      remotionArgs.push(`--fengmotion.remotion.node-modules=${remotionModules}`)
    }
  } else {
    // 找不到就明确记一笔：这会让渲染完全不可用，不该静默
    console.warn(`[backend] 未找到 Remotion 工程：${remotionDir}（渲染将不可用）`)
  }

  const child: ChildProcess = spawn(java, [
    '-jar', jar,
    `--server.port=${port}`,
    `--fengmotion.data-dir=${options.dataDir}`,
    ...remotionArgs,
  ], {
    // 后端只需要本机回环，不需要继承 shell
    stdio: ['ignore', logFd ?? 'ignore', logFd ?? 'ignore'],
    windowsHide: true,
  })

  if (logFd !== undefined) closeSync(logFd)

  let stopped = false
  child.on('exit', (code, signal) => {
    if (!stopped) console.warn(`[backend] 进程退出 code=${code} signal=${signal}`)
  })

  /* 启动窗口给到 180 秒。实测数据：
     · 本地磁盘（unpacked）约 5 秒
     · AppImage 首次挂载运行 30 秒以上，仍在初始化
     原因是 AppImage 是只读 FUSE 镜像，JVM 逐个读取大量 class 比本地磁盘慢一个量级；
     系统页缓存热起来后才接近本地速度。原来给 60 秒，真机首启会被判超时并杀掉后端 ——
     现象是「应用开着但 Agent 一直不可用」，用户无从判断。
     宁可多等，也不要杀掉一个正在正常启动的进程。 */
  const startupTimeoutMs = 180_000
  const healthy = await waitForHealthy(apiBase, startupTimeoutMs)
  if (!healthy) {
    console.error(`[backend] 启动超时（等待 ${startupTimeoutMs / 1000} 秒），终止进程`)
    child.kill()
    return null
  }
  console.log(`[backend] 就绪于 ${apiBase}`)

  return {
    port,
    apiBase,
    alive: () => child.exitCode === null && !child.killed,
    stop: async () => {
      if (stopped) return
      stopped = true
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      // 给它 5 秒优雅退出（Spring 会关连接池、刷 SQLite），再强杀
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
          resolve()
        }, 5000)
        child.once('exit', () => { clearTimeout(timer); resolve() })
      })
    },
  }
}
