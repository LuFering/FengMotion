#!/usr/bin/env bash
# 一条命令跑两道门禁：门 0.5（资源路线）+ 取材（镜头文件）
#
# 用法：
#   bash workflow-v2/gate.sh <片名>                    # 只查门 0.5
#   bash workflow-v2/gate.sh <片名> remotion/city/shots # 连取材一起查
set -euo pipefail
FILM="workflow-v2/片/${1:?用法: gate.sh <片名> [镜头目录]}"
SHOTS="${2:-}"
TOOL="$HOME/AIremotion-skill/03-工具/check-gate.py"

python3 "$TOOL" --film "$FILM" --stage look
if [ -n "$SHOTS" ]; then
  python3 "$TOOL" --film "$FILM" --stage shots --shots "$SHOTS"
fi
