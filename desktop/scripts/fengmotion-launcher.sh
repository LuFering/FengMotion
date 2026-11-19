#!/usr/bin/env bash
# FengMotion 启动器模板：install-desktop.mjs 把 @APP_DIR@ 换成安装目录后写到 ~/.local/bin/fengmotion。
set -euo pipefail

APP_DIR="@APP_DIR@"

# 关键：本机环境里存在 ELECTRON_RUN_AS_NODE=1（可能来自某个 Node 工具链的导出）。
# 一旦带上它，Electron 会退化成纯 Node 进程，require('electron') 只返回二进制路径，
# 应用会立刻报 "Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')"。
# 所以这里必须显式清掉。
unset ELECTRON_RUN_AS_NODE

# 注意：这里**不能**预设 FENGMOTION_API_BASE。
# 主进程用它判断「要不要自己启动后端」—— 设了就会被当成「外部已提供后端」
# 而完全跳过启动，应用随即表现为「连不上 Agent」。
# 只有用户确实要在外部跑后端时才由他自己导出这个变量。

# 读 FengMotion 专用的环境变量文件（例如 DASHSCOPE_API_KEY）。
# 从应用菜单启动时不经过 ~/.bashrc，写在那里的密钥到不了后端，语义检索会退回字面匹配。
# 只解析「名字=值」，不执行文件内容；终端里已设置的变量优先，不被覆盖；不输出任何值。
ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/FengMotion/env"
if [[ -f "$ENV_FILE" ]]; then
  mode="$(stat -c %a "$ENV_FILE")"
  if [[ ! -O "$ENV_FILE" ]] || (( 8#$mode & 8#022 )); then
    # 别人能改这份文件，就能往应用里塞变量
    echo "fengmotion: 跳过 $ENV_FILE：文件不属于当前用户，或其他人可写（建议 chmod 600）" >&2
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

exec "${APP_DIR}/electron/electron" "${APP_DIR}/app/main.cjs" "$@"
