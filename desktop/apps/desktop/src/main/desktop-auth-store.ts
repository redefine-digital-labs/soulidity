import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, safeStorage } from 'electron'

const ENCRYPTED_TOKEN_FILE = 'desktop_token.enc'
const TOKEN_METADATA_FILE = 'desktop_token.json'

interface TokenMetadata {
  accountId: string
  storedAt: number
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

  const metadata: TokenMetadata = { accountId, storedAt: Date.now() }
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

  const metadata = loadMetadata()
  return {
    hasToken: true,
    accountId: metadata?.accountId ?? null,
  }
}
