#!/usr/bin/env bash
set -euo pipefail

PERSIST="/workspaces/.ghostylinux-home"
mkdir -p "$PERSIST"/{Downloads,Documents,Pictures,mozilla,chromium}
mkdir -p "$HOME/Desktop" "$HOME/.config"

# Keep personal files and browser profiles on Codespaces' persistent /workspaces volume.
for name in Downloads Documents Pictures; do
  rm -rf "$HOME/$name"
  ln -s "$PERSIST/$name" "$HOME/$name"
done

rm -rf "$HOME/.mozilla"
ln -s "$PERSIST/mozilla" "$HOME/.mozilla"
rm -rf "$HOME/.config/chromium"
ln -s "$PERSIST/chromium" "$HOME/.config/chromium"
ln -sfn "$PERSIST" "$HOME/GhostyFiles"

xdg-user-dirs-update || true

# Reinstall packages previously recorded with ginstall after a container rebuild.
if [ -s "$PERSIST/packages.txt" ]; then
  sudo apt-get update
  mapfile -t SAVED_PACKAGES < <(grep -E '^[a-zA-Z0-9][a-zA-Z0-9+._:-]*$' "$PERSIST/packages.txt" | sort -u)
  if [ "${#SAVED_PACKAGES[@]}" -gt 0 ]; then
    sudo apt-get install -y "${SAVED_PACKAGES[@]}" || true
  fi
fi

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

This is real x86-64 Linux running in a private GitHub Codespace.

INSTALL APPS
------------
Recommended:
  ginstall package-name

Example:
  ginstall vlc
  ginstall gimp

ginstall installs the package now AND records it so GhostyLinux can restore
it automatically if you rebuild the Codespace container.

Normal apt also works:
  sudo apt update
  sudo apt install package-name

GITHUB
------
  git clone https://github.com/OWNER/REPO.git
  cd REPO

BROWSERS
--------
  firefox-esr
  ghosty-chromium

PERSISTENT FILES
----------------
Use:
  ~/GhostyFiles

Downloads, Documents, Pictures, Firefox profile and Chromium profile are
linked into /workspaces so they survive container rebuilds.

DEV TOOLS INCLUDED
------------------
Git, Python 3, pip, Node.js, npm, GCC/G++, Make, CMake, FFmpeg, ImageMagick.

NOTE
----
Apps installed with ordinary apt survive stop/start, but a full container
rebuild resets the base system. Packages recorded with ginstall are restored.
EOF

cat > "$HOME/.ghostylinux-welcome" <<'EOF'
Welcome to GhostyLinux Cloud.

Desktop: forwarded port 6080
Firefox: firefox-esr
Chromium: ghosty-chromium
Persistent install: ginstall <package>
Persistent files: ~/GhostyFiles
EOF

echo "GhostyLinux setup complete."
