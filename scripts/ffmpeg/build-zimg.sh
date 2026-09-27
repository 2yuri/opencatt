#!/usr/bin/env bash
# Builds zimg (for ffmpeg's zscale filter, OP-71) as a static library into <prefix>, from the
# pinned source, by compiling its portable C++ directly: no autotools, and no x86/ARM SIMD code,
# which the one-off conversions OpenCatt does don't need. Writes <prefix>/lib/pkgconfig/zimg.pc.
# Usage: build-zimg.sh <prefix> <c++ compiler command> <ar> <C++ runtime link flag>
# Run from the repo root, or inside a build container with /project mounted.
set -euo pipefail
PREFIX=$1 CXX=$2 AR=$3 CXXLIB=$4
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/config.sh"
WORK=$(mktemp -d)
curl -sSL "$ZIMG_URL" -o "$WORK/zimg.tar.gz"
(cd "$WORK" && echo "$ZIMG_SHA256  zimg.tar.gz" | { sha256sum -c - 2>/dev/null || shasum -a 256 -c -; })
tar -xzf "$WORK/zimg.tar.gz" -C "$WORK"
SRC="$WORK/zimg-release-$ZIMG_VERSION/src/zimg"
mkdir -p "$PREFIX/lib/pkgconfig" "$PREFIX/include" "$WORK/obj"
find "$SRC" -name '*.cpp' | grep -v -E '/(x86|arm)/' | while read -r f; do
  $CXX -std=c++14 -O2 -I"$SRC" -c "$f" -o "$WORK/obj/$(echo "${f#"$SRC"/}" | tr / _).o"
done
$AR rcs "$PREFIX/lib/libzimg.a" "$WORK"/obj/*.o
cp "$SRC/api/zimg.h" "$PREFIX/include/"
cat > "$PREFIX/lib/pkgconfig/zimg.pc" <<PC
prefix=$PREFIX
Name: zimg
Description: Scaling, colorspace conversion, and dithering library
Version: $ZIMG_VERSION
Libs: -L\${prefix}/lib -lzimg $CXXLIB
Cflags: -I\${prefix}/include
PC
rm -rf "$WORK"
echo "zimg $ZIMG_VERSION -> $PREFIX"
