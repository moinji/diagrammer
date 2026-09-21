#!/bin/bash
# 다이아그래머 실행 — Finder 에서 더블클릭하면 됩니다.
# 처음 한 번은 준비 작업 때문에 1~2분 걸립니다. 그 다음부터는 몇 초면 뜹니다.

cd "$(dirname "$0")" || exit 1

printf '\033]0;다이아그래머\007'
echo "────────────────────────────────────────"
echo "  다이아그래머"
echo "────────────────────────────────────────"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js 가 없습니다."
  echo "   https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  echo
  read -r -p "엔터를 누르면 창이 닫힙니다."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "▸ 처음 실행이라 필요한 것들을 내려받습니다 (1~2분)…"
  npm install || { echo "❌ 설치 실패"; read -r -p "엔터로 종료"; exit 1; }
  echo
fi

# 소스가 빌드본보다 새로우면 다시 빌드
NEED_BUILD=0
if [ ! -f dist/index.html ]; then
  NEED_BUILD=1
elif [ -n "$(find src server index.html vite.config.ts package.json -newer dist/index.html 2>/dev/null | head -1)" ]; then
  NEED_BUILD=1
fi

if [ "$NEED_BUILD" = "1" ]; then
  echo "▸ 앱을 준비합니다…"
  npm run build || { echo "❌ 빌드 실패"; read -r -p "엔터로 종료"; exit 1; }
  echo
fi

echo "▸ 브라우저가 곧 열립니다. 이 창을 닫으면 프로그램이 종료됩니다."
echo
exec node server/index.mjs --serve-dist --open
