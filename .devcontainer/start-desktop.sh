#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:1
export XDG_RUNTIME_DIR="/tmp/ghostylinux-runtime-$USER"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# Kill stale processes from a previous Codespace start.
pkill -f "websockify.*6080" 2>/dev/null || true
pkill -f "Xtigervnc :1" 2>/dev/null || true
pkill -f "startlxde" 2>/dev/null || true
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true

# Start a real VNC-backed X server. This is more reliable in Codespaces than
# chaining Xvfb -> x11vnc -> websockify.
nohup Xtigervnc :1   -geometry 1600x900   -depth 24   -SecurityTypes None   -localhost yes   -AlwaysShared=1   > /tmp/ghostylinux-vnc.log 2>&1 &

for i in $(seq 1 60); do
  if xdpyinfo -display :1 >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! xdpyinfo -display :1 >/dev/null 2>&1; then
  echo "GhostyLinux: VNC X server failed to start."
  cat /tmp/ghostylinux-vnc.log || true
  exit 1
fi

nohup dbus-launch --exit-with-session startlxde   > /tmp/ghostylinux-lxde.log 2>&1 &

# Give LXDE a moment to initialise before exposing the desktop.
sleep 2

nohup websockify --web=/usr/share/novnc/ 6080 localhost:5901   > /tmp/ghostylinux-novnc.log 2>&1 &

for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

echo
echo "=============================================================="
echo " GhostyLinux Cloud is ready."
echo " Open the forwarded port: GhostyLinux Desktop (6080)"
echo " Desktop URL: /vnc.html?autoconnect=1&resize=scale"
echo "=============================================================="
echo
