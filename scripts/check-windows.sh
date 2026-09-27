#!/usr/bin/env bash
# Checks what Windows shows from OpenCatt.exe itself: the icon sizes in its icon group and the
# names in its version resource (ProductName is what Start menu search and Task Manager show).
# The installer's shortcuts, uninstaller and Apps & features entry need a real Windows machine
# or CI; see scripts/build-windows.sh for why Wine can't do it here.
set -euo pipefail
cd "$(dirname "$0")/.."
docker run --rm --platform linux/amd64 -v "$PWD/release-windows":/release debian:bookworm bash -c "
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null && apt-get install -y -qq icoutils >/dev/null 2>&1
  echo '== icon sizes in OpenCatt.exe'
  wrestool -l --type=14 /release/win-unpacked/OpenCatt.exe
  echo '== version names'
  wrestool -x --raw --type=16 /release/win-unpacked/OpenCatt.exe | iconv -f UTF-16LE -t UTF-8 -c \
    | tr -c '[:print:]' '\n' | grep -v '^\$' \
    | grep -A1 -E '^(ProductName|FileDescription|CompanyName|InternalName)\$' | grep -v '^--\$'
  echo '== runtime icons'; ls /release/win-unpacked/resources/icons
"
