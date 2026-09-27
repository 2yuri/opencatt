#!/usr/bin/env bash
# Builds a fully static LGPL ffmpeg + ffprobe for linux-x64 into vendor/ffmpeg/linux-x64/, in an
# Alpine (musl) container, so the binaries run on any distro regardless of its glibc. H.264 is
# encoded by openh264, built from pinned source and linked statically. Needs Docker.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/ffmpeg/config.sh
mkdir -p vendor/ffmpeg/linux-x64
docker run --rm --platform linux/amd64 -v "$PWD":/project -w /project \
  -e FFMPEG_URL="$FFMPEG_URL" -e FFMPEG_SHA256="$FFMPEG_SHA256" -e OPENH264_URL="$OPENH264_URL" -e OPENH264_SHA256="$OPENH264_SHA256" alpine:3.20 sh -c '
  set -e
  apk add --no-cache -q build-base nasm pkgconf zlib-dev zlib-static bash curl xz >/dev/null
  cd /tmp
  curl -sSL "$OPENH264_URL" -o openh264.tar.gz
  echo "$OPENH264_SHA256  openh264.tar.gz" | sha256sum -c -
  mkdir openh264 && tar -xzf openh264.tar.gz -C openh264 --strip-components=1
  make -C openh264 -j"$(nproc)" PREFIX=/opt/deps install-static >/dev/null 2>&1
  # install-static writes no .pc file, and FFmpeg finds openh264 only through pkg-config.
  mkdir -p /opt/deps/lib/pkgconfig
  printf "prefix=/opt/deps\nlibdir=\${prefix}/lib\nincludedir=\${prefix}/include\nName: openh264\nDescription: OpenH264\nVersion: 2.5.1\nLibs: -L\${libdir} -lopenh264 -lstdc++ -lm\nCflags: -I\${includedir}\n" > /opt/deps/lib/pkgconfig/openh264.pc
  bash /project/scripts/ffmpeg/build-zimg.sh /opt/deps g++ ar -lstdc++ >/dev/null
  export PKG_CONFIG_PATH=/opt/deps/lib/pkgconfig
  curl -sSL "$FFMPEG_URL" -o ffmpeg.tar.xz
  echo "$FFMPEG_SHA256  ffmpeg.tar.xz" | sha256sum -c -
  mkdir ffmpeg && tar -xJf ffmpeg.tar.xz -C ffmpeg --strip-components=1
  cd ffmpeg
  bash -c "source /project/scripts/ffmpeg/config.sh && ./configure \"\${FFMPEG_COMMON_FLAGS[@]}\" \
    --pkg-config-flags=--static --extra-cflags=-I/opt/deps/include \
    --extra-ldflags=\"-L/opt/deps/lib -static\" --extra-libs=\"-lstdc++ -lm\" \
    --enable-libopenh264 --enable-encoder=libopenh264" >/tmp/configure.log || { tail -25 ffbuild/config.log; exit 1; }
  make -j"$(nproc)" ffmpeg ffprobe >/tmp/make.log 2>&1 || { tail -30 /tmp/make.log; exit 1; }
  strip ffmpeg ffprobe
  cp ffmpeg ffprobe /project/vendor/ffmpeg/linux-x64/
'
echo "built vendor/ffmpeg/linux-x64: $(du -sh vendor/ffmpeg/linux-x64 | cut -f1)"
