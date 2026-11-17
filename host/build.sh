#!/bin/sh
# Maintainers only. Build the executables included in the clone.
set -eu
cd "$(dirname "$0")/.."
mkdir -p bin
for os in linux darwin windows; do
  suffix=""
  if [ "$os" = windows ]; then suffix=".exe"; fi
  for arch in amd64 arm64; do
    CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -buildvcs=false -ldflags='-s -w' -o "bin/host-$os-$arch$suffix" host/main.go
  done
done
