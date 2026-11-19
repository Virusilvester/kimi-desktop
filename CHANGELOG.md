# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-11-20

Kimi Dock releases (fork of kimi-desktop; versions before 3.0.0 belong to the
upstream project).

### Added

- **Clipboard bridge** — renderer access to the system clipboard through the
  main process: read text / native HTML / rich-text (RTF converted to HTML)
  / images (as data URLs); write text / HTML (with plain-text fallback) /
  images. Formats are enum-restricted over IPC, writes are size-capped, and
  failed image decodes are reported.

### Security

- **Renderer-to-main bridge hardening** — the API proxy accepts no path
  other than `GET`/`POST /chat/completions` (no GET bodies), every userData
  file access is resolved and confined to the userData directory,
  payload-bearing IPC handlers validate their inputs, and the
  `removeAllListeners` hole is removed from the preload bridge.
- Main-process CSP no longer allows `*.moonshot.ai` (leftover of the removed
  Moonshot API-key mode); both CSP enforcement points are in sync.

## [3.0.0] - 2026-11-19

### Changed

- **Kimi Code Plan authentication** — the upstream Moonshot API-key mode is
  replaced with OAuth 2.0 Device Authorization Grant against a Kimi Code
  Plan subscription (`api.kimi.com/coding/v1`). The token never leaves the
  main process (`kimi-code.json`, mode 0600); the model list is fetched at
  login and user-selectable in Settings. Product renamed to Kimi Dock.

### Added

- **arm64 deb packaging with AppArmor** — Ubuntu arm64 `.deb` with a
  postinst-installed AppArmor `userns` profile so the Chromium sandbox stays
  enabled (SUID workarounds rejected by design; AppImage not shipped because
  the profile cannot be packaged into it).
- **Playwright e2e smoke test** — `npm run test:e2e`: window shell, live
  OAuth session, webview target, clipboard roundtrips.

## [v2.0.1] - 2026-02-18

### ✨ Added

- **Offline Support** - Comprehensive offline detection with retry logic and auto-reconnect
- **System Tray Integration** - Minimize to tray, quick access menu, background running
- **Deep Linking Support** - `kimi://` protocol handler for opening specific chats
- **Window State Persistence** - Remembers size, position, and maximized state between sessions
- **Keyboard Shortcuts**
  - `Ctrl/Cmd + R` - Reload page
  - `Ctrl/Cmd + Shift + R` - Force reload (ignore cache)
  - `Ctrl/Cmd + +` - Zoom in
  - `Ctrl/Cmd + -` - Zoom out
  - `Ctrl/Cmd + 0` - Reset zoom
- **Auto-Retry Logic** - Exponential backoff retry (3 attempts) when loading fails
- **Security Hardening**
  - Content Security Policy (CSP) headers
  - Context isolation enabled
  - Sandboxing for webview content
  - Permission request handling
- **Error Boundaries** - Graceful handling of React crashes with restart option
- **Loading States** - Improved loading spinner with retry count display
- **Console Forwarding** - WebView console messages forwarded to main process for debugging
- **App Version Display** - Version shown in title bar

### 🔧 Changed

- **Refactored Styles** - Moved all inline styles to dedicated CSS files
  - `KimiWebView.css` - All webview, loading, offline, and error styles
  - `TitleBar.css` - All title bar and window control styles
- **Improved WebView Configuration**
  - Added `partition="persist:kimi"` for persistent session storage
  - Fixed `allowpopups` syntax for proper popup handling
  - Corrected `webpreferences` format (comma-separated with yes/no values)
  - Added custom user agent string
- **Enhanced Title Bar**
  - Added SVG icons for window controls (minimize, maximize, close)
  - Added app icon and version display
  - Improved hover states and visual feedback

### 🐛 Fixed

- Fixed webview not loading CSS/styles properly
- Fixed `allowpopups` incorrect syntax causing rendering issues
- Fixed CSP blocking external resources from kimi.com
- Fixed webview session not persisting cookies/storage
- Fixed window not remembering maximized state on restart

## [v1.2.0] - 2026-02-16

### 🐛 Bug Fixes

- Fixed bottom content cut-off issue with 100vh/100dvh layout
- Fixed initial window size constraints

## [v1.0.0] - 2026-02-14

- Initial release of Kimi Desktop
- Basic webview wrapper for kimi.com
- Custom title bar implementation
