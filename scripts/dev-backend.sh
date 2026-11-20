#!/usr/bin/env bash
# 开发版后端：用仓库里最新打包的 JAR，连用户的真实数据（与桌面端同一份），端口 8090。
#
# - 真实数据：~/.config/FengMotion/data 与 ~/FengMotion/projects（application.yml 的默认值）。
#   桌面端开着时不能同时跑：两边会写同一个 SQLite 和同一批项目，所以检测到就退出。
# - 8080 留给别处的浏览器调试实例，这里固定用 8090（前端开发版按这个地址连）。
# - 模型与检索的密钥从 ~/.config/FengMotion/env 读（与桌面启动器同一规则：只解析「名字=值」，
#   不执行文件内容，终端里已有的变量优先，不输出任何值）。
# - 后端改了源码后要先在 backend/ 里 `mvn -q -DskipTests package`，再重启本脚本。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAR="$REPO/backend/target/fengmotion-server-0.1.2.jar"
PORT="${FENGMOTION_DEV_PORT:-8090}"
INSTALL="$HOME/.local/opt/fengmotion-desktop/app"

if pgrep -f "$HOME/.local/opt/fengmotion-desktop/" >/dev/null 2>&1; then
  echo "dev-backend: 桌面端 FengMotion 正在运行，它和开发版共用同一份数据；先退出桌面端再启动开发版。" >&2
  exit 1
fi
[[ -f "$JAR" ]] || { echo "dev-backend: 找不到 $JAR，先在 backend/ 里执行 mvn -q -DskipTests package" >&2; exit 1; }

ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/FengMotion/env"
if [[ -f "$ENV_FILE" ]]; then
  mode="$(stat -c %a "$ENV_FILE")"
  if [[ ! -O "$ENV_FILE" ]] || (( 8#$mode & 8#022 )); then
    echo "dev-backend: 跳过 $ENV_FILE：文件不属于当前用户，或其他人可写（建议 chmod 600）" >&2
  else
    assignment='^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$'
    double_quoted='^"(.*)"$'
    single_quoted="^'(.*)'\$"
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      [[ "$line" =~ $assignment ]] || continue
      name="${BASH_REMATCH[2]}"
      value="${BASH_REMATCH[3]}"
      if [[ "$value" =~ $double_quoted || "$value" =~ $single_quoted ]]; then
        value="${BASH_REMATCH[1]}"
      fi
      [[ -n "${!name+x}" ]] || export "$name=$value"
    done < "$ENV_FILE"
  fi
fi

# dsh 是 node 脚本，所在目录要在 PATH 里
export PATH="$HOME/.local/bin:$PATH"

args=(
  "--server.port=$PORT"
  "--fengmotion.remotion.project-dir=$REPO/backend/remotion"
  "--fengmotion.remotion.node-modules=$REPO/frontend/node_modules"
  # 实时预览脚本：工作台「实时」模式由后端按项目拉起 frontend/live-preview/server.mjs
  "--fengmotion.live-preview.project-dir=$REPO/frontend/live-preview"
  "--fengmotion.workflow.dir=$REPO/frontend/workflow-v0.1.1"
  "--fengmotion.fx.assets-dir=$REPO/frontend/dist/capability-assets"
)
[[ -x "$HOME/.local/bin/dsh" ]] && args+=("--fengmotion.harness.bin=$HOME/.local/bin/dsh")
# 素材缩略图用桌面安装里那份 ffmpeg（系统未必装了）
if [[ -x "$INSTALL/resources/ffmpeg/ffmpeg" ]]; then
  args+=("--fengmotion.asset.ffmpeg=$INSTALL/resources/ffmpeg/ffmpeg")
  [[ -x "$INSTALL/resources/ffmpeg/ffprobe" ]] && args+=("--fengmotion.asset.ffprobe=$INSTALL/resources/ffmpeg/ffprobe")
  [[ -d "$INSTALL/resources/ffmpeg/lib" ]] && export LD_LIBRARY_PATH="$INSTALL/resources/ffmpeg/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

JAVA="${JAVA_HOME:+$JAVA_HOME/bin/java}"
JAVA="${JAVA:-/usr/lib/jvm/java-21-openjdk/bin/java}"
cd "$REPO/.."
echo "dev-backend: http://127.0.0.1:$PORT/api （真实数据）"
exec "$JAVA" -jar "$JAR" "${args[@]}"
