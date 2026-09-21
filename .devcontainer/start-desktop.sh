#!/usr/bin/env bash
set -u

export DISPLAY=:1
export XDG_RUNTIME_DIR="/tmp/ghostylinux-runtime-$USER"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# Clean up stale display/socket files from a previous Codespace resume.
pkill -f "websockify.*6080" 2>/dev/null || true
pkill -f "x11vnc.*5901" 2>/dev/null || true
pkill -f "Xvfb :1" 2>/dev/null || true
pkill -f "startlxde" 2>/dev/null || true
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true

nohup Xvfb :1 -screen 0 1600x900x24 -ac -noreset +extension GLX +render \
  > /tmp/ghostylinux-xvfb.log 2>&1 &

for i in $(seq 1 30); do
  if xdpyinfo -display :1 >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

nohup dbus-launch --exit-with-session startlxde \
  > /tmp/ghostylinux-lxde.log 2>&1 &

sleep 1

nohup x11vnc -display :1 -forever -shared -nopw -rfbport 5901 \
  -listen 127.0.0.1 -noxdamage -repeat -xkb \
  > /tmp/ghostylinux-x11vnc.log 2>&1 &

nohup websockify --web=/usr/share/novnc/ 6080 localhost:5901 \
  > /tmp/ghostylinux-novnc.log 2>&1 &

sleep 1

echo
echo "=============================================================="
echo " GhostyLinux Cloud desktop is starting."
echo " Open the forwarded port named: GhostyLinux Desktop (6080)"
echo " Direct path: /vnc.html?autoconnect=1&resize=scale"
echo "=============================================================="
echo

if command -v code >/dev/null 2>&1; then
  code --reuse-window . >/dev/null 2>&1 || true
fi
