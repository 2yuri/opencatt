#!/usr/bin/env bash
# Cross-compiles a static LGPL ffmpeg.exe + ffprobe.exe for win-x64 into vendor/ffmpeg/win32-x64/
# with MinGW-w64 in a Debian container. H.264 is encoded by Windows' own MediaFoundation
# (h264_mf), so no codec library ships with it. Needs Docker.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/ffmpeg/config.sh
mkdir -p vendor/ffmpeg/win32-x64
docker run --rm --platform linux/amd64 -v "$PWD":/project -w /project \
  -e FFMPEG_URL="$FFMPEG_URL" -e FFMPEG_SHA256="$FFMPEG_SHA256" -e ZLIB_URL="$ZLIB_URL" -e ZLIB_SHA256="$ZLIB_SHA256" debian:bookworm bash -c '
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null
  apt-get install -y -qq build-essential gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64 nasm pkg-config curl xz-utils >/dev/null 2>&1
  cd /tmp
  curl -sSL "$ZLIB_URL" -o zlib.tar.gz
  echo "$ZLIB_SHA256  zlib.tar.gz" | sha256sum -c -
  mkdir zlib && tar -xzf zlib.tar.gz -C zlib --strip-components=1
  make -C zlib -f win32/Makefile.gcc PREFIX=x86_64-w64-mingw32- libz.a >/dev/null 2>&1
  mkdir -p /opt/deps/include /opt/deps/lib && cp zlib/zlib.h zlib/zconf.h /opt/deps/include && cp zlib/libz.a /opt/deps/lib
  bash /project/scripts/ffmpeg/build-zimg.sh /opt/deps "x86_64-w64-mingw32-g++ -static-libstdc++" x86_64-w64-mingw32-ar -lstdc++ >/dev/null
  export PKG_CONFIG_PATH=/opt/deps/lib/pkgconfig PKG_CONFIG_LIBDIR=/opt/deps/lib/pkgconfig
  curl -sSL "$FFMPEG_URL" -o ffmpeg.tar.xz
  echo "$FFMPEG_SHA256  ffmpeg.tar.xz" | sha256sum -c -
  mkdir ffmpeg && tar -xJf ffmpeg.tar.xz -C ffmpeg --strip-components=1
  cd ffmpeg
  source /project/scripts/ffmpeg/config.sh
  ./configure "${FFMPEG_COMMON_FLAGS[@]}" --arch=x86_64 --target-os=mingw32 \
    --cross-prefix=x86_64-w64-mingw32- --enable-cross-compile \
    --extra-cflags=-I/opt/deps/include --extra-ldflags="-L/opt/deps/lib -static" \
    --pkg-config=pkg-config --pkg-config-flags=--static \
    --enable-mediafoundation --enable-d3d11va --enable-encoder=h264_mf,aac_mf >/tmp/configure.log || { tail -20 ffbuild/config.log; exit 1; }
  make -j"$(nproc)" ffmpeg.exe ffprobe.exe >/tmp/make.log 2>&1 || { grep -B2 -A8 -m3 "error:" /tmp/make.log; exit 1; }
  x86_64-w64-mingw32-strip ffmpeg.exe ffprobe.exe
  cp ffmpeg.exe ffprobe.exe /project/vendor/ffmpeg/win32-x64/
'
echo "built vendor/ffmpeg/win32-x64: $(du -sh vendor/ffmpeg/win32-x64 | cut -f1)"
