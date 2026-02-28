<p align="center">
  <img src="./build/icon.png" width="120" alt="Kimi Desktop Logo" />
</p>

<h1 align="center">Kimi Desktop</h1>

<p align="center">
  <b>Unofficial desktop client for <a href="https://kimi.com">Kimi AI</a></b><br>
  Built with Electron • Offline-capable • Privacy-focused
</p>

<p align="center">
  <a href="https://github.com/Virusilvester/kimi-desktop/releases">
    <img src="https://img.shields.io/github/v/release/Virusilvester/kimi-desktop?style=flat-square&color=blue" alt="Latest Release" />
  </a>
  <a href="https://github.com/Virusilvester/kimi-desktop/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/Virusilvester/kimi-desktop?style=flat-square&color=green" alt="License" />
  </a>
  <img src="https://img.shields.io/badge/Electron-191970?style=flat-square&logo=Electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React" />
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#downloads">Downloads</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#keyboard-shortcuts">Shortcuts</a> •
  <a href="#development">Development</a>
</p>

---

## ✨ Features

### Core Experience
- **🌐 Native Desktop Wrapper** — Seamless Kimi AI experience with system tray integration and native window controls
- **💾 Persistent Sessions** — Stay logged in with encrypted local storage of credentials
- **🔄 Auto-Recovery** — Intelligent retry logic with exponential backoff for connection issues

### Offline Capabilities (v3.0)
- **📚 Conversation History** — Automatic local storage of all conversations using IndexedDB
- **🔌 Offline Mode** — Continue accessing and searching past conversations without internet
- **🔑 API Integration** — Direct Moonshot API support for offline chat with your own API key
- **📤 Import/Export** — Backup and restore your conversation history as JSON

### Privacy & Security
- **🔒 Context Isolation** — Sandboxed webview with disabled Node.js integration
- **🛡️ Content Security Policy** — Strict CSP headers preventing XSS attacks
- **🔐 Local API Key Storage** — Encrypted-at-rest API credentials
- **🧹 Data Control** — Granular clearing of cache, cookies, history, or all data

### Productivity
- **⚡ Keyboard Shortcuts** — Full keyboard navigation support
- **📐 Window Persistence** — Remembers size, position, and maximized state
- **🎯 Deep Linking** — `kimi://` protocol support for opening specific conversations
- **🔔 Desktop Notifications** — Optional alerts for new messages

---

## 📥 Downloads

Download the latest version from the [Releases](https://github.com/Virusilvester/kimi-desktop/releases) page.

| Platform | Download | Notes |
|----------|----------|-------|
| **Windows** | `.exe` (Installer) | Windows 10/11, auto-updates supported |
| **Linux** | `.AppImage` | Portable, works on most distributions |
| | `.deb` | Debian, Ubuntu, Mint |
| | `.rpm` | Fedora, RHEL, openSUSE |
| | `.snap` | Ubuntu Snap Store |

> **Note:** macOS is not currently supported. If you're a Mac user, consider using the web version at [kimi.com](https://kimi.com) or building from source.

### System Requirements

- **Windows**: Windows 10 version 1809 or later
- **Linux**: Ubuntu 18.04+, Fedora 32+, or equivalent with glibc 2.31+

---

## 🚀 Installation

### Windows
1. Download `Kimi-Desktop-Setup-x.x.x.exe` from [Releases](https://github.com/Virusilvester/kimi-desktop/releases)
2. Run the installer (administrator rights not required for user install)
3. Launch from Start Menu or Desktop shortcut

> **SmartScreen Warning:** Windows may show a SmartScreen warning since the app is not code-signed with an expensive EV certificate. Click "More info" → "Run anyway" to proceed.

### Linux

#### AppImage (Recommended - Works everywhere)
```bash
# Download
wget https://github.com/Virusilvester/kimi-desktop/releases/download/v3.0.0/Kimi-Desktop-3.0.0.AppImage

# Make executable
chmod +x Kimi-Desktop-3.0.0.AppImage

# Run
./Kimi-Desktop-3.0.0.AppImage
```

#### Debian/Ubuntu (.deb)
```bash
sudo dpkg -i kimi-desktop_3.0.0_amd64.deb
sudo apt-get install -f  # Fix dependencies if needed
```

#### Fedora/RHEL (.rpm)
```bash
sudo rpm -i kimi-desktop-3.0.0.x86_64.rpm
```

#### Snap Store
```bash
sudo snap install kimi-desktop
```

---

## 🎮 Usage

### First Launch
1. Sign in to your Kimi account (webview)
2. *(Optional)* Add your Moonshot API key in **Settings → API Key** for offline chat
3. Start chatting — conversations auto-save locally

### Offline Mode
When internet disconnects:
- 🟡 **Yellow indicator** appears in title bar
- 📂 Access all saved conversations via sidebar (`Ctrl+Shift+S`)
- ✏️ Continue chatting if API key is configured (responses via Moonshot API)
- 🔄 Auto-reconnect when network returns

### Conversation Management
- **Search** (`Ctrl+Shift+S`): Find any message across all conversations
- **Filter**: View all or offline-only conversations
- **Export**: Backup as JSON via Settings → General
- **Delete**: Individual conversation removal with confirmation

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + R` | Reload page |
| `Ctrl/Cmd + Shift + R` | Force reload (ignore cache) |
| `Ctrl/Cmd + +` | Zoom in |
| `Ctrl/Cmd + -` | Zoom out |
| `Ctrl/Cmd + 0` | Reset zoom |
| `Ctrl/Cmd + Shift + S` | Toggle conversation sidebar |
| `Ctrl/Cmd + ,` | Open Settings |
| `Ctrl/Cmd + W` | Close window (minimize to tray) |
| `Ctrl/Cmd + Q` | Quit application |

---

## 🛠️ Development

### Prerequisites
- [Node.js](https://nodejs.org/) 18.x or later
- npm 9.x or later (or yarn/pnpm)

### Setup
```bash
# Clone repository
git clone https://github.com/Virusilvester/kimi-desktop.git
cd kimi-desktop

# Install dependencies
npm install

# Run in development mode (hot reload)
npm run dev

# Build for production
npm run build

# Package for distribution
npm run release:win    # Windows
npm run release:linux  # Linux
```

### Project Structure
```
kimi-desktop/
├── src/
│   ├── main/           # Electron main process (IPC, window management)
│   ├── preload/        # Preload scripts (secure bridge)
│   └── renderer/       # React frontend (UI components)
├── build/              # Build resources (icons, entitlements)
├── resources/          # Static assets
└── electron.vite.config.ts  # Build configuration
```

### Tech Stack
- **Electron** — Cross-platform desktop framework
- **Vite** — Fast build tooling and HMR
- **React 18** — UI framework with TypeScript
- **IndexedDB** — Client-side conversation storage
- **electron-builder** — Distribution packaging

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📜 License

Distributed under the MIT License. See [LICENSE](./LICENSE) for more information.

---

## 🙏 Acknowledgments

- [Electron](https://www.electronjs.org/) — Cross-platform desktop apps
- [Moonshot AI](https://www.moonshot.ai/) — Kimi AI platform
- [electron-vite](https://electron-vite.org/) — Modern Electron build tooling
- Icons by [Heroicons](https://heroicons.com/)

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/Virusilvester">Virusilvester</a></sub>
</p>
