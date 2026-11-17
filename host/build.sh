#!/bin/sh
# Maintainers only. Build the four executables included in the clone.
set -eu
cd "$(dirname "$0")/.."
mkdir -p bin
for os in linux darwin; do
  for arch in amd64 arm64; do
    CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -buildvcs=false -ldflags='-s -w' -o "bin/host-$os-$arch" host/main.go
  done
done
