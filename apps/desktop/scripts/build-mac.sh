#!/bin/bash
# Flowsmith macOS 앱 만들기 — ★Mac에서(codesign이 있어야 한다). 저장소 뿌리에서:  bash apps/desktop/scripts/build-mac.sh [--smoke]
#   → apps/desktop/stage/dist/Flowsmith-<판>-mac-{arm64,x64}.dmg
#   --smoke  만든 앱(이 Mac의 아키텍처)을 켜서 편집 화면 · 띄우기 · 앱 안 브라우저 실행을 확인한다(smoke.ts)
# ☆인증서 서명 · 공증은 하지 않는다 — ad-hoc 서명만. 받은 사람은 처음 한 번 «그래도 열기»나 `xattr -cr /Applications/Flowsmith.app`
set -euo pipefail
cd "$(dirname "$0")/../../.."
[ "$(uname)" = "Darwin" ] || { echo "macOS 앱은 Mac에서만 만듭니다(codesign)"; exit 1; }
pnpm install --frozen-lockfile
pnpm studio:build
STAGE=apps/desktop/stage
node apps/desktop/scripts/stage.ts "$STAGE"
( cd "$STAGE" && npm install --no-audit --no-fund && node node_modules/electron/install.js && npx electron-builder --mac --arm64 --x64 )
ls -lh "$STAGE"/dist/*.dmg
if [ "${1:-}" = "--smoke" ]; then
  ARCH=$([ "$(uname -m)" = "arm64" ] && echo mac-arm64 || echo mac)
  node apps/desktop/scripts/smoke.ts "$STAGE/dist/$ARCH/Flowsmith.app/Contents/MacOS/Flowsmith" "$STAGE/dist/smoke"
fi
