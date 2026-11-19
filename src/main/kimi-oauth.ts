/*
 * Kimi Code OAuth (Device Authorization Grant, RFC 8628).
 * Ported from MoonshotAI/kimi-cli src/kimi_cli/auth/oauth.py.
 * Uses the Kimi Code Plan subscription via https://api.kimi.com/coding/v1.
 */
import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'
import os from 'os'
import { randomUUID } from 'crypto'

const OAUTH_HOST =
  process.env.KIMI_CODE_OAUTH_HOST || process.env.KIMI_OAUTH_HOST || 'https://auth.kimi.com'
const CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098'
const CODING_API_BASE = process.env.KIMI_CODE_BASE_URL || 'https://api.kimi.com/coding/v1'

const REFRESH_THRESHOLD_SECONDS = 300

export interface OAuthToken {
  access_token: string
  refresh_token: string
  expires_at: number
  scope: string
  token_type: string
  expires_in: number
}

export interface KimiModel {
  id: string
  display_name: string | null
  context_length: number
}

interface OAuthStateFile {
  token: OAuthToken
  models: KimiModel[]
  selectedModel: string | null
}

export type OAuthEventType = 'verification_url' | 'waiting' | 'success' | 'error'

export interface OAuthEvent {
  type: OAuthEventType
  message: string
  data?: Record<string, unknown>
}

export interface OAuthStatus {
  loggedIn: boolean
  expiresAt?: number
  models: KimiModel[]
  selectedModel: string | null
}

let loginInProgress = false
let cancelLogin = false

function statePath(): string {
  return join(app.getPath('userData'), 'kimi-code.json')
}

function deviceIdPath(): string {
  return join(app.getPath('userData'), 'device_id')
}

function getDeviceId(): string {
  const path = deviceIdPath()
  try {
    if (fs.existsSync(path)) return fs.readFileSync(path, 'utf-8').trim()
  } catch {
    // fall through and regenerate
  }
  const id = randomUUID().replace(/-/g, '')
  try {
    fs.writeFileSync(path, id, { encoding: 'utf-8', mode: 0o600 })
  } catch {
    // ignore persistence errors
  }
  return id
}

function deviceModel(): string {
  const system = process.platform
  const arch = os.arch()
  if (system === 'darwin') return `macOS ${os.release()} ${arch}`
  if (system === 'win32') return `Windows ${os.release()} ${arch}`
  if (system === 'linux') return `Linux ${os.release()} ${arch}`
  return `${system} ${arch}`
}

function asciiHeader(value: string, fallback = 'unknown'): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value.trim() || fallback
  const sanitized = value.replace(/[^\x20-\x7E]/g, '').trim()
  return sanitized || fallback
}

function commonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Msh-Platform': 'kimi_cli',
    'X-Msh-Version': app.getVersion(),
    'X-Msh-Device-Name': os.hostname(),
    'X-Msh-Device-Model': deviceModel(),
    'X-Msh-Os-Version': os.version ? os.version() : os.release(),
    'X-Msh-Device-Id': getDeviceId()
  }
  for (const key of Object.keys(headers)) {
    headers[key] = asciiHeader(headers[key])
  }
  return headers
}

function loadState(): OAuthStateFile | null {
  try {
    const path = statePath()
    if (!fs.existsSync(path)) return null
    return JSON.parse(fs.readFileSync(path, 'utf-8')) as OAuthStateFile
  } catch {
    return null
  }
}

function saveState(state: OAuthStateFile): void {
  const path = statePath()
  const tmp = `${path}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: 'utf-8', mode: 0o600 })
  try {
    fs.chmodSync(tmp, 0o600)
  } catch {
    // ignore chmod errors on platforms that do not support it
  }
  fs.renameSync(tmp, path)
}

export function getStatus(): OAuthStatus {
  const state = loadState()
  if (!state?.token?.access_token) {
    return { loggedIn: false, models: [], selectedModel: null }
  }
  return {
    loggedIn: true,
    expiresAt: state.token.expires_at,
    models: state.models ?? [],
    selectedModel: state.selectedModel ?? state.models?.[0]?.id ?? null
  }
}

export function logout(): void {
  try {
    const path = statePath()
    if (fs.existsSync(path)) fs.unlinkSync(path)
  } catch {
    // ignore
  }
}

export function selectModel(modelId: string): { success: boolean; error?: string } {
  const state = loadState()
  if (!state) return { success: false, error: 'Not logged in' }
  if (!state.models.some((m) => m.id === modelId)) {
    return { success: false, error: 'Unknown model' }
  }
  state.selectedModel = modelId
  saveState(state)
  return { success: true }
}

interface DeviceAuthorization {
  user_code: string
  device_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number | null
  interval: number
}

async function requestDeviceAuthorization(): Promise<DeviceAuthorization> {
  const response = await fetch(`${OAUTH_HOST}/api/oauth/device_authorization`, {
    method: 'POST',
    headers: commonHeaders(),
    body: new URLSearchParams({ client_id: CLIENT_ID })
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(`Device authorization failed: HTTP ${response.status}: ${JSON.stringify(data)}`)
  }
  return {
    user_code: String(data.user_code),
    device_code: String(data.device_code),
    verification_uri: String(data.verification_uri || ''),
    verification_uri_complete: String(data.verification_uri_complete),
    expires_in: data.expires_in ? Number(data.expires_in) : null,
    interval: Math.max(Number(data.interval) || 5, 1)
  }
}

async function pollDeviceToken(
  deviceCode: string
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${OAUTH_HOST}/api/oauth/token`, {
    method: 'POST',
    headers: commonHeaders(),
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  })
  const data = (await response.json()) as Record<string, unknown>
  return { status: response.status, data }
}

async function refreshTokens(refreshToken: string): Promise<OAuthToken> {
  const response = await fetch(`${OAUTH_HOST}/api/oauth/token`, {
    method: 'POST',
    headers: commonHeaders(),
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  })
  const data = (await response.json()) as Record<string, unknown>
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Token refresh unauthorized: ${String(data.error_description || response.status)}`
    )
  }
  if (!response.ok) {
    throw new Error(`Token refresh failed: HTTP ${response.status}`)
  }
  return tokenFromResponse(data)
}

function tokenFromResponse(data: Record<string, unknown>): OAuthToken {
  const expiresIn = Number(data.expires_in)
  return {
    access_token: String(data.access_token),
    refresh_token: String(data.refresh_token),
    expires_at: Date.now() / 1000 + expiresIn,
    scope: String(data.scope || ''),
    token_type: String(data.token_type || 'Bearer'),
    expires_in: expiresIn
  }
}

export async function ensureFreshAccessToken(): Promise<string | null> {
  const state = loadState()
  if (!state?.token) return null
  const now = Date.now() / 1000
  if (state.token.expires_at - now >= REFRESH_THRESHOLD_SECONDS) {
    return state.token.access_token
  }
  return forceRefreshAccessToken()
}

export async function forceRefreshAccessToken(): Promise<string | null> {
  const state = loadState()
  if (!state?.token) return null
  try {
    const refreshed = await refreshTokens(state.token.refresh_token)
    state.token = refreshed
    saveState(state)
    return refreshed.access_token
  } catch (error) {
    console.error('[OAuth] Token refresh failed:', error)
    if (error instanceof Error && error.message.includes('unauthorized')) {
      logout()
    }
    return null
  }
}

export async function fetchModels(accessToken: string): Promise<KimiModel[]> {
  const response = await fetch(`${CODING_API_BASE}/models`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!response.ok) {
    throw new Error(`Failed to list models: HTTP ${response.status}`)
  }
  const data = (await response.json()) as { data?: Array<Record<string, unknown>> }
  if (!Array.isArray(data.data)) return []
  return data.data
    .filter((item) => typeof item.id === 'string')
    .map((item) => ({
      id: item.id as string,
      display_name: item.display_name ? String(item.display_name) : null,
      context_length: Number(item.context_length) || 0
    }))
}

export async function startLogin(onEvent: (event: OAuthEvent) => void): Promise<void> {
  if (loginInProgress) {
    onEvent({ type: 'error', message: 'Login already in progress' })
    return
  }
  loginInProgress = true
  cancelLogin = false
  try {
    const auth = await requestDeviceAuthorization()
    // The server returns a www.kimi.com URL; international accounts live on
    // kimi.ai (same authorize_device app, same backend). Prefer it.
    const verificationUrl = auth.verification_uri_complete.replace(
      'https://www.kimi.com/',
      'https://www.kimi.ai/'
    )
    onEvent({
      type: 'verification_url',
      message: `Verification URL: ${verificationUrl}`,
      data: {
        verification_url: verificationUrl,
        user_code: auth.user_code
      }
    })

    const deadline = Date.now() + (auth.expires_in ?? 300) * 1000
    let printedWaiting = false
    while (Date.now() < deadline) {
      if (cancelLogin) {
        onEvent({ type: 'error', message: 'Login cancelled' })
        return
      }
      await new Promise((resolve) => setTimeout(resolve, auth.interval * 1000))
      const { status, data } = await pollDeviceToken(auth.device_code)
      if (status === 200 && data.access_token) {
        const token = tokenFromResponse(data)
        const models = await fetchModels(token.access_token)
        if (models.length === 0) {
          onEvent({ type: 'error', message: 'No models available for this account' })
          return
        }
        saveState({ token, models, selectedModel: models[0].id })
        onEvent({
          type: 'success',
          message: `Logged in successfully. ${models.length} models available.`,
          data: { models }
        })
        return
      }
      const errorCode = String(data.error || 'unknown_error')
      if (errorCode === 'expired_token') {
        onEvent({ type: 'error', message: 'Device code expired, please try again' })
        return
      }
      if (!printedWaiting) {
        onEvent({
          type: 'waiting',
          message:
            `Waiting for authorization... ${String(data.error_description || '').trim()}`.trim()
        })
        printedWaiting = true
      }
    }
    onEvent({ type: 'error', message: 'Device code expired, please try again' })
  } catch (error) {
    console.error('[OAuth] Login failed:', error)
    onEvent({ type: 'error', message: `Login failed: ${(error as Error).message}` })
  } finally {
    loginInProgress = false
  }
}

export function cancelOngoingLogin(): void {
  cancelLogin = true
}

export { CODING_API_BASE }
