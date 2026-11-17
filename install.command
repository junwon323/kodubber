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
exec "./bin/host-${os}-${arch}" install
