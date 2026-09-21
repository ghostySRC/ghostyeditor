FROM mcr.microsoft.com/devcontainers/base:bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:1
ENV GHOSTYLINUX=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    lxde-core lxterminal pcmanfm lxappearance \
    tigervnc-standalone-server novnc websockify dbus-x11 x11-utils x11-xserver-utils xdg-utils xdg-user-dirs \
    chromium firefox-esr \
    git git-lfs curl wget aria2 ca-certificates gnupg \
    python3 python3-pip python3-venv \
    nodejs npm \
    build-essential cmake pkg-config \
    ffmpeg imagemagick \
    unzip zip p7zip-full tar gzip bzip2 xz-utils \
    nano vim less htop jq ripgrep tree file procps netcat-openbsd \
    fonts-dejavu fonts-liberation fonts-noto-core \
    libgl1-mesa-dri mesa-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN git lfs install --system || true

RUN printf '%s\n' \
  '<!doctype html><meta charset="utf-8"><title>GhostyLinux Desktop</title><script>location.replace("vnc.html?autoconnect=1&resize=scale&quality=8&compression=2")</script>' \
  > /usr/share/novnc/index.html

COPY .devcontainer/ghosty-chromium /usr/local/bin/ghosty-chromium
COPY .devcontainer/ginstall /usr/local/bin/ginstall
RUN chmod +x /usr/local/bin/ghosty-chromium /usr/local/bin/ginstall
