#!/usr/bin/env bash
# Fills vendor/ffmpeg/<platform>-<arch>/ with the pinned LGPL ffmpeg + ffprobe that electron-builder
# ships (OP-62). They're downloaded from this repo's ffmpeg release and checked against
# scripts/ffmpeg/checksums.sha256, so builds are reproducible and nothing large lives in git.
# Usage: scripts/ffmpeg/fetch.sh [darwin-arm64 darwin-x64 win32-x64 linux-x64 | all]
# With no argument, fetches what this machine's installers need (both archs on a Mac).
set -euo pipefail
cd "$(dirname "$0")/../.."
# The release lives on the private working repo (OP-87). OP-85 republishes it on the public repo,
# and the public copy of this script points there; OPENCATT_FFMPEG_REPO overrides either.
RELEASE_REPO=${OPENCATT_FFMPEG_REPO:-2yuri/opencatt}
RELEASE_TAG=ffmpeg-8.1.3-lgpl-2
ALL=(darwin-arm64 darwin-x64 win32-x64 linux-x64)
if [ $# -eq 0 ]; then
  case "$(uname -s)-$(uname -m)" in
    # A Mac build (dist:mac, or dist on a Mac) makes both the arm64 and the x64 app.
    Darwin-*) set -- darwin-arm64 darwin-x64 ;;
    Linux-x86_64) set -- linux-x64 ;;
    MINGW*|MSYS*|CYGWIN*) set -- win32-x64 ;;
    *) echo "No ffmpeg build for $(uname -s)-$(uname -m)"; exit 1 ;;
  esac
elif [ "$1" = all ]; then
  set -- "${ALL[@]}"
fi
# Git Bash on Windows has sha256sum but no shasum; macOS has shasum only.
if command -v sha256sum >/dev/null; then sha256=(sha256sum); else sha256=(shasum -a 256); fi

for target in "$@"; do
  archive="ffmpeg-8.1.3-lgpl-$target.tar.gz"
  tmp=$(mktemp -d)
  # The repo may be private: use the GitHub CLI's login when there is one, else GITHUB_TOKEN (CI).
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    gh release download "$RELEASE_TAG" --repo "$RELEASE_REPO" --pattern "$archive" --dir "$tmp"
  else
    auth=()
    [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
    url=$(curl -fsSL ${auth[@]+"${auth[@]}"} \
      "https://api.github.com/repos/$RELEASE_REPO/releases/tags/$RELEASE_TAG" |
      node -e 'let j="";process.stdin.on("data",d=>j+=d).on("end",()=>{const a=JSON.parse(j).assets.find(x=>x.name===process.argv[1]);process.stdout.write(a?a.url:"")})' "$archive")
    [ -n "$url" ] || { echo "Can't find $archive in $RELEASE_REPO@$RELEASE_TAG (private repo? set GITHUB_TOKEN)"; exit 1; }
    curl -fsSL ${auth[@]+"${auth[@]}"} -H "Accept: application/octet-stream" "$url" -o "$tmp/$archive"
  fi
  (cd "$tmp" && grep " $archive\$" "$OLDPWD/scripts/ffmpeg/checksums.sha256" | "${sha256[@]}" -c -)
  rm -rf "vendor/ffmpeg/$target" && mkdir -p "vendor/ffmpeg/$target"
  tar -xzf "$tmp/$archive" -C "vendor/ffmpeg/$target"
  rm -rf "$tmp"
  echo "vendor/ffmpeg/$target ready"
done
