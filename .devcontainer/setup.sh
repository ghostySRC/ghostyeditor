#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$HOME/Desktop" "$HOME/Downloads" "$HOME/Documents" "$HOME/Pictures" "$HOME/.config"
xdg-user-dirs-update || true

cat > "$HOME/Desktop/Firefox.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Firefox
Comment=Modern Firefox ESR browser
Exec=firefox-esr
Icon=firefox-esr
Terminal=false
Categories=Network;WebBrowser;
EOF

cat > "$HOME/Desktop/Chromium.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Chromium
Comment=Chromium browser
Exec=ghosty-chromium
Icon=chromium
Terminal=false
Categories=Network;WebBrowser;
EOF

cat > "$HOME/Desktop/Terminal.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Terminal
Exec=lxterminal
Icon=utilities-terminal
Terminal=false
Categories=System;TerminalEmulator;
EOF

cat > "$HOME/Desktop/Files.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Files
Exec=pcmanfm
Icon=system-file-manager
Terminal=false
Categories=System;FileTools;FileManager;
EOF

cat > "$HOME/Desktop/GitHub.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=GitHub
Exec=ghosty-chromium https://github.com
Icon=chromium
Terminal=false
Categories=Network;
EOF

chmod +x "$HOME"/Desktop/*.desktop

cat > "$HOME/Desktop/START-HERE.txt" <<'EOF'
GhostyLinux Cloud
=================

This is a real x86-64 Linux Codespace, not the old 32-bit browser emulator.

Useful commands:

  sudo apt update
  sudo apt install PACKAGE

  git clone https://github.com/OWNER/REPO.git

  python3 --version
  node --version
  gcc --version

Browsers:
  firefox-esr
  ghosty-chromium

Your files and installed packages normally remain in this Codespace until you rebuild or delete it.
The Codespace stops automatically when idle, which saves your included GitHub Codespaces usage.
EOF

cat > "$HOME/.ghostylinux-welcome" <<'EOF'
Welcome to GhostyLinux Cloud.

Desktop: port 6080
Firefox: firefox-esr
Chromium: ghosty-chromium
Install packages: sudo apt install <package>
EOF

echo "GhostyLinux setup complete."
