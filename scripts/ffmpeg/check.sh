#!/usr/bin/env bash
# Refuses an ffmpeg build that isn't LGPL-only or lacks the H.264 encoder its platform relies on.
# Reads the configure line embedded in each binary, so it works for any platform's files.
# Usage: scripts/ffmpeg/check.sh <dir> [<platform>-<arch>]  (the dir name is used when it is one)
set -euo pipefail
dir=$1
target=${2:-$(basename "$dir")}
bin="$dir/ffmpeg"; [ -f "$bin.exe" ] && bin="$bin.exe"
[ -f "$bin" ] || { echo "no ffmpeg in $dir"; exit 1; }
conf=$(strings "$bin" | grep -m1 -e '--disable-everything' || true)
[ -n "$conf" ] || { echo "$target: no embedded configure line found"; exit 1; }
if grep -qE -- '--enable-(gpl|nonfree|version3)' <<<"$conf"; then
  echo "$target: not LGPL 2.1-only: $conf"; exit 1
fi
case "$target" in
  darwin-*) need=h264_videotoolbox ;;
  win32-*) need=h264_mf ;;
  linux-*) need=libopenh264 ;;
  *) echo "unknown platform $target; pass it as the second argument"; exit 1 ;;
esac
grep -q -- "$need" <<<"$conf" || { echo "$target: $need missing from configure"; exit 1; }
# HDR tone mapping (OP-71) needs zscale, which needs zimg.
grep -q -- '--enable-libzimg' <<<"$conf" || { echo "$target: zscale (libzimg) missing from configure"; exit 1; }
echo "$target: LGPL-only, encoder $need, $(du -sh "$dir" | cut -f1)"
