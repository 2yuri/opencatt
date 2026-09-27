# FFmpeg in OpenCatt

OpenCatt ships `ffmpeg` and `ffprobe` from FFmpeg 8.1.3 (https://ffmpeg.org), licensed under
the GNU Lesser General Public License version 2.1 or later (LICENSE-LGPL-2.1.txt). They are
separate programs that OpenCatt runs; they are not linked into OpenCatt.

This build is LGPL only: it is configured without `--enable-gpl` and without
`--enable-nonfree`, so it contains no GPL or non-free code. H.264 video is encoded by each
platform's own encoder: VideoToolbox on macOS, Media Foundation on Windows, and openh264 on Linux.

## Source

- FFmpeg 8.1.3 source: https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz
  (sha256 7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3, signed by the
  FFmpeg release key FCF986EA15E6E293A5644F10B4322F04D67658D8)
- The exact build scripts and configure flags: `scripts/ffmpeg/` in
  https://github.com/2yuri/opencatt
- The same source and the built binaries are also attached to the repository's
  `ffmpeg-8.1.3-lgpl-2` release.

You may replace these binaries with your own build of FFmpeg: put your `ffmpeg` and `ffprobe` in
the app's `resources/ffmpeg` folder.

## Also included

- Linux only: openh264 2.5.1, built from its source (https://github.com/cisco/openh264) and
  linked statically, under the BSD 2-Clause licence, LICENSE-openh264.txt. This is not Cisco's
  prebuilt binary.
- Windows and Linux: zlib 1.3.1 (https://zlib.net), zlib licence, LICENSE-zlib.txt.
- All platforms: zimg 3.0.5 (https://github.com/sekrit-twc/zimg), built from its source and linked
  statically for the zscale filter that tone-maps HDR video, under the WTFPL, LICENSE-zimg.txt.
