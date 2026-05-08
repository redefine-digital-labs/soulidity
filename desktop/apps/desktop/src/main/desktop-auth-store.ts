import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, safeStorage } from 'electron'
import { getDesktopWebBaseUrl } from './web-api'

const ENCRYPTED_TOKEN_FILE = 'desktop_token.enc'
const TOKEN_METADATA_FILE = 'desktop_token.json'

interface TokenMetadata {
  accountId: string
  storedAt: number
  // The web base URL that issued this token. If the desktop later points at a
  // different web app, the token won't be recognized by the new server. We
  // surface this URL so the unlink flow can target the *issuing* server and
  // tear down the original `DesktopPet` / agent `Member` rows; clearing the
  // token locally without that revoke step would orphan them server-side.
  webBaseUrl: string
}

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'state')
}

function getEncryptedTokenPath(): string {
  return path.join(getStatePath(), ENCRYPTED_TOKEN_FILE)
}

function getMetadataPath(): string {
  return path.join(getStatePath(), TOKEN_METADATA_FILE)
}

// ── safeStorage 加密层 ──────────────────────────

export function storeDesktopToken(token: string, accountId: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this system')
  }

  const encrypted = safeStorage.encryptString(token)
  const dir = getStatePath()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getEncryptedTokenPath(), encrypted)

  const metadata: TokenMetadata = {
    accountId,
    storedAt: Date.now(),
    webBaseUrl: getDesktopWebBaseUrl(),
  }
  fs.writeFileSync(getMetadataPath(), JSON.stringify(metadata, null, 2))
}

export function loadDesktopToken(): string | null {
  try {
    const encrypted = fs.readFileSync(getEncryptedTokenPath())
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

export function clearDesktopToken(): void {
  try { fs.unlinkSync(getEncryptedTokenPath()) } catch { /* already gone */ }
  try { fs.unlinkSync(getMetadataPath()) } catch { /* already gone */ }
}

function loadMetadata(): TokenMetadata | null {
  try {
    const raw = fs.readFileSync(getMetadataPath(), 'utf-8')
    return JSON.parse(raw) as TokenMetadata
  } catch {
    return null
  }
}

export function getDesktopAuthStatus(): { hasToken: boolean; accountId: string | null } {
  const token = loadDesktopToken()
  if (!token) {
    return { hasToken: false, accountId: null }
  }

  // Even if the metadata is missing or its `webBaseUrl` differs from the
  // currently-configured one, we MUST NOT silently clear the token here:
  // the matching `DesktopPet` + agent `Member` rows still live on the issuing
  // server, and the token is the only credential that can revoke them. The
  // verification path (`/api/desktop/me`) will surface a mismatch as a 401
  // and route the UI into the `canUnlink: true` error state, where the
  // unlink IPC tears the server-side rows down against the issuing URL.
  const metadata = loadMetadata()
  return {
    hasToken: true,
    accountId: metadata?.accountId ?? null,
  }
}

// Returns the `webBaseUrl` that issued the currently-stored desktop token, so
// the unlink IPC can revoke against the original server even after the user
// repoints `SOULIDITY_WEB_URL` (or a new `DEFAULT_WEB_BASE_URL` ships). Tokens
// saved before webBaseUrl tracking existed have no field — callers fall back
// to the current base URL, which is the only address they can reach anyway.
export function loadDesktopTokenIssuingWebBaseUrl(): string | null {
  const metadata = loadMetadata()
  if (!metadata?.webBaseUrl) return null
  return metadata.webBaseUrl
}
