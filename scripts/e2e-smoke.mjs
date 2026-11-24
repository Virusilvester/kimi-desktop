/*
 * E2E smoke test for Kimi Dock using Playwright's Electron API.
 * Verifies: window loads, title bar renders, OAuth session is picked up,
 * webview points at kimi.ai. Screenshots land in /tmp/kimi-desktop-e2e/.
 *
 * With a working AppArmor userns profile this runs WITH the Chromium
 * sandbox enabled; pass --no-sandbox to opt out.
 */
import { _electron as electron } from 'playwright'
import fs from 'node:fs'

const SHOTS = '/tmp/kimi-desktop-e2e'
fs.mkdirSync(SHOTS, { recursive: true })

const noSandbox = process.argv.includes('--no-sandbox')
const app = await electron.launch({
  args: ['.'],
  chromiumSandbox: !noSandbox
})

try {
  const window = await app.firstWindow()

  // 1) App shell renders
  await window.waitForSelector('.titlebar', { timeout: 15000 })
  const title = await window.textContent('.title .version')
  console.log('[e2e] Window OK, version badge:', title?.trim() || '(none)')

  // 2) OAuth session from userData (migrated from upstream ~/.config/kimi-desktop)
  const oauth = await window.evaluate(() => window.api.oauthStatus())
  console.log('[e2e] OAuth loggedIn:', oauth.loggedIn)
  console.log('[e2e] Models:', oauth.models.length, '| selected:', oauth.selectedModel)
  if (!oauth.loggedIn) throw new Error('Expected an active OAuth session')

  // 3) WebView is present and targets kimi.ai
  const webviewSrc = await window.evaluate(() =>
    document.querySelector('webview')?.getAttribute('src')
  )
  console.log('[e2e] WebView src:', webviewSrc)
  if (webviewSrc !== 'https://kimi.ai') throw new Error(`Unexpected webview src: ${webviewSrc}`)

  await window.screenshot({ path: `${SHOTS}/01-main.png` })

  // 4) Open Settings → Kimi Account tab
  await window.keyboard.press('Control+,')
  await window.waitForSelector('.settings-modal', { timeout: 5000 })
  await window.click('text=Kimi Account')
  await window.waitForSelector('text=Connected', { timeout: 5000 })
  const modelSelect = await window.isVisible('select.endpoint-select')
  console.log('[e2e] Settings → Kimi Account: Connected, model selector visible:', modelSelect)
  await window.screenshot({ path: `${SHOTS}/02-kimi-account.png` })

  // 5) Clipboard bridge roundtrip: write + read back text, image and rich-text.
  // Side effect: clobbers the user's clipboard — snapshot and restore what
  // the API can represent (text/image data URLs). Electron's clipboard.write
  // replaces the whole clipboard per call, and the bridge has no combined
  // write, so when the original clipboard held both text and image, the
  // image restore wins and the text layer is lost. Other formats (files,
  // RTF without an HTML layer) are lost outright.
  const prevText = await window.evaluate(() => window.api.clipboardRead('text'))
  const prevImage = await window.evaluate(() => window.api.clipboardRead('image'))
  try {
    const clipTextWrite = await window.evaluate(() =>
      window.api.clipboardWrite('text', 'kimi-dock-clipboard-e2e')
    )
    const clipTextRead = await window.evaluate(() => window.api.clipboardRead('text'))
    if (!clipTextWrite?.success || clipTextRead?.value !== 'kimi-dock-clipboard-e2e') {
      throw new Error(
        `Clipboard text roundtrip failed: ${JSON.stringify({ clipTextWrite, clipTextRead })}`
      )
    }
    const PIXEL_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    await window.evaluate((dataUrl) => window.api.clipboardWrite('image', dataUrl), PIXEL_PNG)
    const clipImageRead = await window.evaluate(() => window.api.clipboardRead('image'))
    if (!clipImageRead?.value || !clipImageRead.value.startsWith('data:image/')) {
      throw new Error(`Clipboard image roundtrip failed: ${JSON.stringify(clipImageRead)}`)
    }
    await window.evaluate(() =>
      window.api.clipboardWrite('html', '<p>rich <strong>text</strong></p>')
    )
    const clipRichRead = await window.evaluate(() => window.api.clipboardRead('rich-text'))
    if (!clipRichRead?.value || !clipRichRead.value.includes('rich')) {
      throw new Error(`Clipboard rich-text read failed: ${JSON.stringify(clipRichRead)}`)
    }
    console.log('[e2e] Clipboard roundtrip OK (text + image + rich-text)')
  } finally {
    if (typeof prevText?.value === 'string') {
      await window.evaluate((t) => window.api.clipboardWrite('text', t), prevText.value)
    }
    if (typeof prevImage?.value === 'string') {
      await window.evaluate((d) => window.api.clipboardWrite('image', d), prevImage.value)
    }
  }

  // 6) Force-offline toggle: the real title-bar button is the primary action.
  // The app runs against real userData and a partial payload makes main fill
  // absent keys from defaults — snapshot first and restore the snapshot
  // verbatim in the finally block.
  const prevSettings = await window.evaluate(() => window.api.getSettings())
  let restoreError = null
  try {
    // Step 4 left the Settings modal open; its overlay would intercept the
    // title-bar click.
    await window.click('.settings-modal .close-btn')
    await window.waitForSelector('.settings-modal', { state: 'detached', timeout: 5000 })

    // Force a known starting state: on a machine where the developer
    // actually uses the toggle, the first click below must turn it ON, not
    // OFF. The finally restores the untouched prevSettings snapshot.
    const preset = await window.evaluate((prev) => {
      return window.api.saveSettings({ ...prev, forceOfflineMode: false })
    }, prevSettings)
    if (!preset?.success) {
      throw new Error(`Failed to preset forceOfflineMode=false: ${JSON.stringify(preset)}`)
    }

    await window.click('.force-offline-toggle')
    await window.waitForSelector('.offline-chat-view', { timeout: 5000 })
    const forcedBadge = await window.isVisible('.offline-indicator.forced')
    const reconnectVisible = await window.isVisible('text=Try Reconnecting')
    console.log(
      '[e2e] Force offline: offline view shown, forced badge:',
      forcedBadge,
      '| reconnect button visible:',
      reconnectVisible
    )
    if (!forcedBadge) throw new Error('Forced Offline badge not shown')
    if (reconnectVisible) throw new Error('Try Reconnecting must be hidden in forced mode')
    await window.screenshot({ path: `${SHOTS}/03-forced-offline.png` })

    await window.click('.force-offline-toggle')
    await window.waitForSelector('webview.kimi-webview', { timeout: 5000 })
    console.log('[e2e] Force offline: webview restored after clicking the toggle again')
  } finally {
    const restore = await window.evaluate((s) => window.api.saveSettings(s), prevSettings)
    if (!restore?.success) {
      restoreError = new Error(
        `Failed to restore settings after force-offline test: ${JSON.stringify(restore)}`
      )
    }
  }
  if (restoreError) throw restoreError

  // 7) Artifact editor surface: the title-bar toggle swaps the main area to
  // the editor and back; the webview stays mounted (CSS-hidden), and after
  // the first open the editor does too (unsaved buffers survive). Depending
  // on whether a workspace folder is configured, the editor shows the
  // choose-folder prompt, the chat picker, or the artifact list.
  await window.click('.editor-toggle')
  await window.waitForSelector('.editor-view', { timeout: 5000 })
  const editorState = await window.evaluate(() => {
    if (document.querySelector('.editor-sidebar')) return 'artifacts'
    if (document.querySelector('.chat-dir-list')) return 'picker'
    return 'unset-prompt'
  })
  console.log('[e2e] Editor surface shown:', editorState)
  await window.screenshot({ path: `${SHOTS}/04-editor.png` })

  await window.click('.editor-toggle')
  await window.waitForSelector('webview.kimi-webview', { timeout: 5000 })
  // Keep-mounted editor: it leaves the visible surface but stays in the DOM.
  await window.waitForSelector('.editor-view', { state: 'hidden', timeout: 5000 })
  console.log('[e2e] Editor surface hidden, webview restored')

  console.log('[e2e] PASS')
} finally {
  await app.close()
}
