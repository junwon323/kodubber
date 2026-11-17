#!/bin/sh
set -eu
cd "$(dirname "$0")"
case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo '지원 운영체제는 Linux와 macOS입니다.' >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo '지원 CPU는 Intel/AMD 64비트와 ARM64입니다.' >&2; exit 1 ;;
esac
"./bin/host-${os}-${arch}" install
if [ "$os" = darwin ] && [ "${1:-}" != "--no-gui" ]; then
  echo 'Chrome에서 개발자 모드를 켜고 Finder에서 선택된 extension 폴더를 확장 관리 화면으로 끌어다 놓으세요.'
  open -R "$PWD/extension" || :
  open -a "Google Chrome" 'chrome://extensions/' || echo 'Chrome 주소창에서 chrome://extensions 를 직접 여세요.'
fi
