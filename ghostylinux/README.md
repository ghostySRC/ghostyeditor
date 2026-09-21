# GhostyLinux Web

A Chromebook-friendly browser Linux playground.

## Current profiles
- Damn Small Linux — graphical JWM desktop with Firefox 2
- TinyCore 11
- Buildroot Linux
- NodeOS
- KolibriOS

## Features
- Real x86 VM in WebAssembly
- Graphical Linux desktop
- Guest networking through the public v86 WebSocket relay
- Chromebook clipboard paste button
- Save/load complete VM state
- Fullscreen and keyboard shortcuts
- “Modern web” helper that opens current websites in Chrome while the VM keeps running

## Important limits
The default in-VM Firefox is intentionally old and cannot handle many modern HTTPS/JavaScript sites. The VM is 32-bit x86 and is emulated in the browser, so modern x86_64-only software, GPU drivers, Docker/KVM, and very heavy applications are outside its practical scope.

## Credits
GhostyLinux customization: ghosty.
v86: Fabian Hemmer / copy.sh, BSD-2-Clause.
WebLinux UI/asset base: alizafarbati/WebLinux, BSD-2-Clause.
