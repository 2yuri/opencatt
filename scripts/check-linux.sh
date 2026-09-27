#!/usr/bin/env bash
# Installs the .deb from release-linux/ in a clean Debian container, starts OpenCatt under Xvfb
# and prints what a Linux desktop would show: the .desktop entry, installed icons, window title
# and WM_CLASS. Saves a screenshot to release-linux/shots/linux-window.png. Needs Docker; on Apple
# Silicon it runs amd64 under emulation (slow but fine). Build first with scripts/build-linux.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
DEB=$(ls release-linux/*.deb | head -1)
mkdir -p release-linux/shots
docker run --rm --platform linux/amd64 -v "$PWD/release-linux":/release debian:bookworm bash -c "
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null
  apt-get install -y -qq xvfb x11-utils imagemagick dbus-x11 >/dev/null 2>&1
  apt-get install -y -qq /release/$(basename "$DEB") >/dev/null 2>&1
  echo '== .desktop'; cat /usr/share/applications/opencat*.desktop
  echo '== hicolor icons'; find /usr/share/icons/hicolor -name '*.png' | sort
  echo '== resources/icons'; ls /opt/*/resources/icons
  set +e
  Xvfb :99 -screen 0 1400x900x24 >/dev/null 2>&1 &
  export DISPLAY=:99
  sleep 2
  EXE=\$(grep -m1 '^Exec=' /usr/share/applications/opencat*.desktop | sed 's/^Exec=//; s/ %U//')
  \$EXE --no-sandbox --user-data-dir=/tmp/profile >/tmp/app.log 2>&1 &
  WID=
  for i in \$(seq 1 120); do
    WID=\$(xwininfo -root -tree 2>/dev/null | grep -i '\"opencatt\"' | head -1 | awk '{print \$1}')
    [ -n \"\$WID\" ] && break; sleep 2
  done
  echo '== window'
  if [ -z \"\$WID\" ]; then echo 'no OpenCatt window after 240s'; tail -30 /tmp/app.log; exit 1; fi
  xprop -id \$WID WM_CLASS WM_NAME _NET_WM_NAME
  echo '== _NET_WM_ICON'; xprop -id \$WID -len 8 _NET_WM_ICON
  sleep 15
  import -window root /release/shots/linux-window.png
  echo '== app log (last lines)'; tail -5 /tmp/app.log
"
