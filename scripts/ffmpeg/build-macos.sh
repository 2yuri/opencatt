#!/usr/bin/env bash
# Builds LGPL ffmpeg + ffprobe for macOS arm64 and x86_64 into vendor/ffmpeg/darwin-<arch>/,
# from the pinned, checksum-verified FFmpeg source. H.264 goes through VideoToolbox.
# The x86_64 build is cross-compiled from Apple Silicon with asm off (no nasm needed).
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/ffmpeg/config.sh
WORK="${TMPDIR:-/tmp}/opencatt-ffmpeg"
mkdir -p "$WORK"
TARBALL="$WORK/ffmpeg-${FFMPEG_VERSION}.tar.xz"
[ -f "$TARBALL" ] || curl -sSL "$FFMPEG_URL" -o "$TARBALL"
echo "${FFMPEG_SHA256}  ${TARBALL}" | shasum -a 256 -c -

for ARCH in ${ARCHS:-arm64 x86_64}; do
  SRC="$WORK/src-$ARCH"
  rm -rf "$SRC" && mkdir -p "$SRC" && tar -xJf "$TARBALL" -C "$SRC" --strip-components=1
  OUT_ARCH=$([ "$ARCH" = x86_64 ] && echo x64 || echo arm64)
  OUT="$PWD/vendor/ffmpeg/darwin-$OUT_ARCH"
  EXTRA=()
  if [ "$ARCH" != "$(uname -m)" ]; then
    EXTRA=(--enable-cross-compile --arch="$ARCH" --target-os=darwin --disable-x86asm)
  elif [ "$ARCH" = x86_64 ]; then
    EXTRA=(--disable-x86asm)
  fi
  ZIMG_PREFIX="$WORK/zimg-$ARCH"
  bash scripts/ffmpeg/build-zimg.sh "$ZIMG_PREFIX" "clang++ -arch $ARCH -mmacosx-version-min=11.0" ar -lc++
  (
    cd "$SRC"
    export ZIMG_PREFIX
    ./configure "${FFMPEG_COMMON_FLAGS[@]}" ${EXTRA[@]+"${EXTRA[@]}"} \
      --pkg-config="$OLDPWD/scripts/ffmpeg/pkg-config-zimg.sh" --pkg-config-flags=--static \
      --cc="clang -arch $ARCH" --extra-cflags="-mmacosx-version-min=11.0" \
      --extra-ldflags="-mmacosx-version-min=11.0" \
      --enable-videotoolbox --enable-audiotoolbox \
      --enable-encoder=h264_videotoolbox,hevc_videotoolbox,aac_at \
      --enable-hwaccel=h264_videotoolbox,hevc_videotoolbox >"$WORK/configure-$ARCH.log"
    make -j"$(sysctl -n hw.ncpu)" ffmpeg ffprobe >"$WORK/make-$ARCH.log" 2>&1
  )
  mkdir -p "$OUT"
  cp "$SRC/ffmpeg" "$SRC/ffprobe" "$OUT/"
  strip -x "$OUT/ffmpeg" "$OUT/ffprobe"
  # Every Mac binary gets an ad-hoc signature (arm64 won't run without one; x86_64 gets one for
  # consistency). OP-14's Developer ID signing replaces it.
  codesign --force --sign - "$OUT/ffmpeg" "$OUT/ffprobe"
  echo "built $OUT: $(du -sh "$OUT" | cut -f1)"
done
