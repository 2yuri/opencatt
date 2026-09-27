#!/usr/bin/env bash
# Builds the Linux AppImage and .deb into release-linux/ inside electronuserland/builder, so it
# works from macOS too. The renderer and main bundles are built on the host first (they're the
# same on every OS); only packaging runs in the container.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" -e HOME=/tmp/home \
  -v "$PWD":/project -w /project electronuserland/builder:wine \
  bash -c 'mkdir -p $HOME && node node_modules/electron-builder/cli.js --linux deb AppImage --x64 --publish never -c.directories.output=release-linux'
