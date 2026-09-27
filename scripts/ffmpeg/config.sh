# Shared by every platform's build. Sourced, not run.
#
# FFmpeg for OpenCatt: LGPL only (no --enable-gpl, no --enable-nonfree), and only what video
# attach needs (OP-18) plus render_video's fallback (OP-35): read the usual phone and web video
# formats, probe them, scale and pad, and write H.264 + AAC in MP4. H.264 is encoded by the
# platform's own encoder (VideoToolbox, MediaFoundation, openh264), because libx264 is GPL.
# Memory: opencat-bundles-ffmpeg-for-video.

FFMPEG_VERSION=8.1.3
FFMPEG_SHA256=7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"

FFMPEG_COMMON_FLAGS=(
  --disable-everything
  --disable-autodetect
  --disable-doc
  --disable-ffplay
  --disable-network
  --disable-debug
  --enable-small
  --enable-zlib
  --enable-avdevice
  --enable-indev=lavfi
  --enable-avfilter
  --enable-swscale
  --enable-swresample
  --enable-protocol=file,pipe
  --enable-demuxer=mov,matroska,avi,mpegts,flv,gif,mp3,aac,wav,ogg,image2,image2pipe,rawvideo,png_pipe
  --enable-muxer=mp4,mov,null
  --enable-decoder=h264,hevc,vp8,vp9,mpeg4,mpeg2video,mpeg1video,prores,mjpeg,gif,png,rawvideo,wrapped_avframe
  --enable-decoder=aac,aac_latm,mp3,mp3float,opus,vorbis,flac,alac,ac3,eac3,pcm_s16le,pcm_s24le,pcm_f32le,pcm_s16be
  --enable-encoder=aac
  --enable-parser=h264,hevc,vp8,vp9,mpeg4video,mpegvideo,aac,aac_latm,mpegaudio,opus,vorbis,flac,ac3,mjpeg,png,gif
  --enable-bsf=h264_mp4toannexb,hevc_mp4toannexb,aac_adtstoasc,extract_extradata,vp9_superframe
  --enable-filter=scale,format,fps,aresample,aformat,pad,crop,setsar,setdar,transpose,hflip,vflip,null,anull,copy,acopy,trim,atrim
  # testsrc2 and sine make test clips for the self-checks without shipping sample files.
  --enable-filter=testsrc2,sine
  # HDR (an iPhone's HLG, HDR10's PQ) to SDR BT.709 for X (OP-71): zscale from zimg, plus tonemap.
  --enable-libzimg
  --enable-filter=zscale,tonemap
)

# openh264 (BSD-2) is Linux's H.264 encoder; zlib (zlib licence) backs the PNG decoder.
OPENH264_VERSION=2.5.1
OPENH264_SHA256=a1b5c88bfb31c4d2251835e57a7df99f91181955cea6ec3ddd4ab82aa54ae9f1
OPENH264_URL="https://github.com/cisco/openh264/archive/refs/tags/${OPENH264_VERSION}.tar.gz"
ZLIB_VERSION=1.3.1
ZLIB_SHA256=9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23
ZLIB_URL="https://github.com/madler/zlib/releases/download/v${ZLIB_VERSION}/zlib-${ZLIB_VERSION}.tar.gz"

# zimg (WTFPL) backs the zscale filter that tone-maps HDR video (OP-71); scripts/ffmpeg/build-zimg.sh.
ZIMG_VERSION=3.0.5
ZIMG_SHA256=a9a0226bf85e0d83c41a8ebe4e3e690e1348682f6a2a7838f1b8cbff1b799bcf
ZIMG_URL="https://github.com/sekrit-twc/zimg/archive/refs/tags/release-${ZIMG_VERSION}.tar.gz"
