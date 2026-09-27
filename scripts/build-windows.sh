#!/usr/bin/env bash
# Builds the unpacked Windows app (release-windows/win-unpacked/OpenCatt.exe) inside
# electronuserland/builder:wine, from any OS. The icon and version names are written with
# electron-builder's JS resource editor, so they're real. The NSIS installer is not built here:
# electron-builder runs it under Wine to make the uninstaller, and Wine crashes under amd64
# emulation on Apple Silicon (OrbStack/Rosetta). Build the installer on Windows or in CI
# (.github/workflows/release.yml, windows-latest).
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" -e HOME=/tmp/home \
  -v "$PWD":/project -w /project electronuserland/builder:wine \
  bash -c 'mkdir -p $HOME && node node_modules/electron-builder/cli.js --win dir --x64 --publish never -c.directories.output=release-windows'
