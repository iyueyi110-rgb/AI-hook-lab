#!/bin/bash

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
DEFAULT_PORT_CANDIDATES="3000 3010 3011 3012 3020"
PORT_CANDIDATES="${AI_HOOK_PORT_CANDIDATES:-$DEFAULT_PORT_CANDIDATES}"
SERVER_PID=""
PORT=""

fail() {
  echo
  echo "启动失败：$1"
  if [[ -t 0 ]]; then
    read -r -p "按回车键关闭窗口..." _
  fi
  exit 1
}

cleanup() {
  local exit_code=$?
  trap - EXIT

  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo
    echo "正在停止 AI Hook Lab..."
    if command -v pkill >/dev/null 2>&1; then
      pkill -TERM -P "$SERVER_PID" >/dev/null 2>&1 || true
    fi
    kill -TERM "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi

  echo "AI Hook Lab 已停止。"
  exit "$exit_code"
}

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

choose_port() {
  local candidate
  for candidate in $PORT_CANDIDATES; do
    if [[ ! "$candidate" =~ ^[0-9]+$ ]] || ((candidate < 1 || candidate > 65535)); then
      continue
    fi
    if ! port_in_use "$candidate"; then
      PORT="$candidate"
      return 0
    fi
  done
  return 1
}

open_pages_when_ready() {
  local home_url="$1"
  local dashboard_url="$2"
  local attempt=1

  while ((attempt <= 30)); do
    if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
      return 1
    fi
    if curl --silent --fail --max-time 1 --output /dev/null "$home_url"; then
      if [[ "${AI_HOOK_SKIP_OPEN:-0}" != "1" ]]; then
        open "$HOME_URL"
        open "$DASHBOARD_URL"
      fi
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  return 2
}

main() {
  cd "$PROJECT_DIR" || fail "无法进入项目目录：$PROJECT_DIR"

  echo
  echo "========================================"
  echo " AI Hook Lab - macOS 一键启动"
  echo "========================================"
  echo

  command -v node >/dev/null 2>&1 || fail "未找到 Node.js，请先安装：https://nodejs.org/"
  command -v npm >/dev/null 2>&1 || fail "未找到 npm，请重新安装 Node.js：https://nodejs.org/"
  command -v curl >/dev/null 2>&1 || fail "未找到 curl，无法检查服务状态。"
  command -v lsof >/dev/null 2>&1 || fail "未找到 lsof，无法检查端口。"

  if [[ ! -d "node_modules" ]]; then
    echo "首次运行，正在安装依赖。这可能需要几分钟..."
    npm install || fail "依赖安装失败，请检查网络和 npm 日志。"
  fi

  if [[ ! -f ".env.local" ]]; then
    if [[ -f ".env.local.example" ]]; then
      cp ".env.local.example" ".env.local" || fail "无法创建 .env.local。"
    else
      printf 'DEEPSEEK_API_KEY=\nDATABASE_URL=\nEVAL_INGEST_TOKEN=\n' > ".env.local" || fail "无法创建 .env.local。"
    fi
    echo "已创建 .env.local。生成 Hook 前请填写 DEEPSEEK_API_KEY。"
    if [[ "${AI_HOOK_SKIP_OPEN:-0}" != "1" ]]; then
      open -a TextEdit ".env.local"
    fi
  fi

  choose_port || fail "端口均被占用，已检查：$PORT_CANDIDATES"

  HOME_URL="http://localhost:$PORT"
  DASHBOARD_URL="$HOME_URL/dashboard"

  echo "使用端口：$PORT"
  echo "首页：$HOME_URL"
  echo "数据看板：$DASHBOARD_URL"
  echo "按 Control+C 可停止服务。"
  echo

  npm run dev -- -p "$PORT" &
  SERVER_PID=$!

  open_pages_when_ready "$HOME_URL" "$DASHBOARD_URL"
  case $? in
    0)
      echo "服务已就绪，首页和数据看板已打开。"
      ;;
    1)
      fail "Next.js 服务在就绪前退出，请查看上方日志。"
      ;;
    2)
      echo "服务在 30 秒内未响应，因此没有自动打开浏览器。请继续查看终端日志。"
      ;;
  esac

  wait "$SERVER_PID"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

main "$@"
