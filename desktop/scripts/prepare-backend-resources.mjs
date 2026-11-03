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
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const backendDir = path.resolve(repoRoot, '..', 'FengMotion-backend')
const outRoot = path.join(repoRoot, 'electron', 'resources')
const jreDir = path.join(outRoot, 'jre')
const backendOut = path.join(outRoot, 'backend')

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

  console.log('\n[1/3] 构建后端 jar')
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
  console.log('\n[2/3] 裁剪 JRE (jlink)')

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

/* ── 3. 校验 ─────────────────────────────────────────────── */
function verify() {
  console.log('\n[3/3] 校验产物')
  const java = path.join(jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  const jar = path.join(backendOut, 'fengmotion-server.jar')
  if (!existsSync(java)) throw new Error(`JRE 缺少 java 可执行文件：${java}`)
  if (!existsSync(jar)) throw new Error(`后端 jar 缺失：${jar}`)

  const version = execFileSync(java, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  console.log('  JRE:', version.split('\n')[0])
  console.log('  jar:', (statSync(jar).size / 1024 / 1024).toFixed(1) + ' MB')

  const jreSize = execFileSync('du', ['-sh', jreDir], { encoding: 'utf8' }).split('\t')[0]
  console.log('  JRE 体积:', jreSize)
}

buildJar()
buildJre()
verify()
console.log('\n打包资源已就绪：electron/resources/')
