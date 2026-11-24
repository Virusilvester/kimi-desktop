# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.4.0] - 2026-11-24

### Added

- **Force offline mode** — an explicit switch for the offline chat UI that
  no longer requires pulling the network cable. A quick toggle button in the
  title bar (cloud-off icon) and a checkbox in Settings → Advanced flip one
  persisted setting (`forceOfflineMode`); the title bar badge reads "Forced
  Offline" to distinguish the state from a real network outage. In forced
  mode the offline view hides "Try Reconnecting" (reloading the hidden
  webview is meaningless there). Chat behavior is unchanged: responses still
  go through the Kimi Code API proxy, so offline mode keeps its established
  semantics — local persistence works without network, answers do not.

### Removed

- The "Enable Offline Mode" setting from Settings → General — it was a no-op
  left from upstream (never read by any code path; saved conversations are
  always accessible). Settings files carrying the stale key are cleaned up on
  the first save after upgrade.

## [3.3.1] - 2026-11-22

### Removed

- The constant "Kimi Code" badge from the title bar — a leftover of the
  upstream API-endpoint indicator: with a live session the green check
  already carries the same information. The offline chat's "Kimi Code Ready"
  badge is unchanged.

## [3.3.0] - 2026-11-21

### Fixed

- **Schema migrations no longer erase saved conversations** — the local chat
  database recreated its entire object store on every schema bump, which
  would have deleted all offline conversations at the first version change.
  Upgrades are now additive: the v2→v3 migration keeps every conversation
  and adds the new fields in place, with all timestamps preserved
  byte-for-byte.
- **`updatedAt` semantics fixed at the storage layer** — the store stamped
  `updatedAt` with the current time on every save, so imports and operational
  writes silently rewrote history and re-sorted the conversation list.
  Records are now written as given: `updatedAt` means "last user-visible
  activity" and is set by the caller; imported conversations keep their
  original timestamps. (The offline-chat autosave still refreshes
  `updatedAt` while a chat is open; that flow is reworked with the upcoming
  sync queue.)

### Added

- **Sync-ready message schema** — each message carries a per-conversation
  sequence number (monotonic, issued by the store) and a sync status
  (`pending` / `syncing` / `synced` / `failed`); each conversation carries a
  `hasPending` flag, indexed as the basis of the future offline sync queue.
  Conversations saved by older versions are backfilled automatically
  (`synced`, sequence by position).
- **Database migration test** — `npm run test:e2e:migration` seeds a
  database from the previous schema in a throwaway profile and verifies that
  the app migrates it without data loss, that the backfill lands, and that
  the conversation list still shows the migrated chats.

## [3.2.1] - 2026-11-21

### Fixed

- **Google sign-in actually opens the account-picker popup** — the 3.2.0 flow
  never surfaced the popup: `allowpopups` was set on the webview imperatively
  after guest attach, and a webview that gains the attribute later still drops
  every `window.open` from the guest (observed Electron 39). The attribute is
  now rendered by React at element creation, so it is present at attach time.
- **FedCM neutralization is now deterministic** — instead of patching
  `CredentialsContainer.prototype.get` from the embedder (which landed
  unreliably after guest navigations), the app disables the `FedCm`
  Chromium feature, so identity requests reject natively with
  `NotSupportedError` and Google Identity Services reliably falls back to its
  OAuth popup.

## [3.2.0] - 2026-11-20

### Added

- **Google sign-in in the webview** — "Continue with Google" now completes:
  the app neutralizes FedCM in the guest page (Google Identity Services only
  falls back to its OAuth popup when FedCM is unavailable; this Chromium
  throws while parsing GIS's FedCM options, which GIS does not treat as
  unavailable), hosts the resulting accounts.google.com popup in-app, and
  closes it after the redirect back to kimi.ai, reloading the webview into
  the logged-in state. Requires the `allowpopups` attribute on the webview
  (made reliable in 3.2.1: it must be present at guest-attach time).

### Fixed

- The webview silently dropped every `window.open` (including external
  links) because the `allowpopups` attribute never made it into the DOM;
  popups are now routed: identity-provider login popups stay in-app,
  everything else opens in the system browser.

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
