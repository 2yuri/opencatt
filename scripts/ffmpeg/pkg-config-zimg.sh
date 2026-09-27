#!/usr/bin/env bash
# A stand-in pkg-config for macOS, which has none: answers ffmpeg's configure for zimg only,
# from the zimg.pc that build-zimg.sh writes into $ZIMG_PREFIX.
set -euo pipefail
PC="$ZIMG_PREFIX/lib/pkgconfig/zimg.pc"
field() { sed -n "s/^$1: //p" "$PC" | sed "s#\${prefix}#$ZIMG_PREFIX#g"; }
for arg in "$@"; do
  case "$arg" in
    --version) echo 0.29.2; exit 0 ;;
    --modversion) field Version; exit 0 ;;
    --cflags) field Cflags; exit 0 ;;
    --libs) field Libs; exit 0 ;;
  esac
done
# --exists and the like: only zimg exists.
for arg in "$@"; do case "$arg" in zimg*) exit 0 ;; esac; done
exit 1
