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

  console.log('[e2e] PASS')
} finally {
  await app.close()
}
