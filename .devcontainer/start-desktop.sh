#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:1
export XDG_RUNTIME_DIR="/tmp/ghostylinux-runtime-$USER"
mkdir -p "$XDG_RUNTIME_DIR" "$HOME/.vnc"
chmod 700 "$XDG_RUNTIME_DIR" "$HOME/.vnc"

cat > "$HOME/.vnc/xstartup" <<'EOF'
#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
export XDG_RUNTIME_DIR="/tmp/ghostylinux-runtime-$USER"
exec dbus-launch --exit-with-session startlxde
EOF
chmod +x "$HOME/.vnc/xstartup"

# Clean stale processes/sockets from previous resumes.
pkill -f "websockify.*6080" 2>/dev/null || true
tigervncserver -kill :1 >/dev/null 2>&1 || true
pkill -f "Xtigervnc :1" 2>/dev/null || true
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true

# Start the graphical desktop directly on a TigerVNC X server.
tigervncserver :1 \
  -geometry 1600x900 \
  -depth 24 \
  -localhost yes \
  -SecurityTypes None \
  -AlwaysShared \
  -xstartup "$HOME/.vnc/xstartup" \
  > /tmp/ghostylinux-vnc-start.log 2>&1

# Verify VNC is genuinely listening before starting noVNC.
for i in $(seq 1 60); do
  if nc -z 127.0.0.1 5901 >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! nc -z 127.0.0.1 5901 >/dev/null 2>&1; then
  echo "GhostyLinux: VNC server failed to listen on 5901."
  cat /tmp/ghostylinux-vnc-start.log 2>/dev/null || true
  find "$HOME/.vnc" -maxdepth 1 -type f -name '*.log' -print -exec tail -n 100 {} \; 2>/dev/null || true
  exit 1
fi

nohup websockify --web=/usr/share/novnc/ 6080 127.0.0.1:5901 \
  > /tmp/ghostylinux-novnc.log 2>&1 &

for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null 2>&1; then
  echo "GhostyLinux: noVNC failed to start on 6080."
  cat /tmp/ghostylinux-novnc.log 2>/dev/null || true
  exit 1
fi

echo
echo "=============================================================="
echo " GhostyLinux Cloud is READY"
echo " VNC backend: 127.0.0.1:5901"
echo " Web desktop: port 6080"
echo " Open: /vnc.html?autoconnect=1&resize=scale"
echo "=============================================================="
echo
