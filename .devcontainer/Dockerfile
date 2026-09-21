FROM mcr.microsoft.com/devcontainers/base:bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    lxde-core lxterminal pcmanfm lxappearance \
    xvfb x11vnc novnc websockify dbus-x11 x11-utils x11-xserver-utils xdg-utils xdg-user-dirs \
    chromium firefox-esr \
    git git-lfs curl wget aria2 ca-certificates gnupg \
    python3 python3-pip python3-venv \
    nodejs npm \
    build-essential cmake pkg-config \
    ffmpeg imagemagick \
    unzip zip p7zip-full tar gzip bzip2 xz-utils \
    nano vim less htop jq ripgrep tree file \
    fonts-dejavu fonts-liberation fonts-noto-core \
    libgl1-mesa-dri mesa-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN git lfs install --system || true

COPY .devcontainer/ghosty-chromium /usr/local/bin/ghosty-chromium
RUN chmod +x /usr/local/bin/ghosty-chromium

ENV DISPLAY=:1
ENV GHOSTYLINUX=1
