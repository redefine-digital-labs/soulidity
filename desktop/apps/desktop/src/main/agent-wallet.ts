import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, safeStorage } from 'electron'

const PUBLIC_METADATA_FILE = 'agent_keypair.json'
const ENCRYPTED_SECRET_FILE = 'agent_secret.enc'
const LEGACY_SECRET_FILE = 'agent_secret.json'

export interface AgentKeypairInfo {
  address: string
  publicKey: string
  createdAt: number
}

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'state')
}

function getMetadataPath(): string {
  return path.join(getStatePath(), PUBLIC_METADATA_FILE)
}

function getEncryptedSecretPath(): string {
  return path.join(getStatePath(), ENCRYPTED_SECRET_FILE)
}

function getLegacySecretPath(): string {
  return path.join(getStatePath(), LEGACY_SECRET_FILE)
}

// ── safeStorage 加密层 ──────────────────────────

function storeSecret(secretKeyHex: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this system')
  }
  const encrypted = safeStorage.encryptString(secretKeyHex)
  const dir = getStatePath()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getEncryptedSecretPath(), encrypted)
}

function loadSecret(): string | null {
  try {
    const encrypted = fs.readFileSync(getEncryptedSecretPath())
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

// ── Phase 1 → Phase 1.5 迁移 ───────────────────

/** 将 Phase 1 明文 JSON 私钥迁移到 safeStorage 加密存储 */
function migrateLegacySecret(): string | null {
  const legacyPath = getLegacySecretPath()
  try {
    const raw = fs.readFileSync(legacyPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (typeof parsed.secretKey !== 'string') return null

    // 迁移到加密存储
    storeSecret(parsed.secretKey)
    // 删除明文文件
    fs.unlinkSync(legacyPath)
    console.log('[agent-wallet] migrated legacy secret to safeStorage, deleted plaintext file')
    return parsed.secretKey
  } catch {
    return null
  }
}

// ── Secret 解码 ────────────────────────────────

/**
 * Decode the stored agent secret to its canonical bech32 form.
 *
 * Two stored shapes are tolerated:
 *   1. Encrypted-on-disk form — `safeStorage.decryptString` returns the
 *      hex-of-utf-8 of the bech32 string (`Buffer.from(<bech32>).toString('hex')`).
 *      This matches what `storeSecret` writes via `generateAgentKeypair`.
 *   2. Legacy in-memory passthrough — `migrateLegacySecret` returns the bech32
 *      string directly (after also persisting the hex form to safeStorage).
 *
 * Exposed for testability.
 */
export function decodeStoredSecret(stored: string): string {
  if (typeof stored !== 'string' || stored.length === 0) {
    throw new Error('Stored agent secret is empty')
  }

  // Legacy passthrough form: already a bech32 string.
  if (stored.startsWith('suiprivkey1')) {
    return stored
  }

  // Encrypted-on-disk form: hex of utf-8 bytes of the bech32 string.
  // `Buffer.from(hex, 'hex')` silently truncates on invalid hex; verify
  // round-trip by re-encoding and comparing length.
  if (!/^[0-9a-fA-F]+$/.test(stored) || stored.length % 2 !== 0) {
    throw new Error('Stored agent secret is not in expected bech32-hex form')
  }

  const decoded = Buffer.from(stored, 'hex').toString('utf-8')
  if (!decoded.startsWith('suiprivkey1')) {
    throw new Error('Stored agent secret is not in expected bech32-hex form')
  }
  return decoded
}

// ── 公开 API ───────────────────────────────────

export async function loadAgentKeypair(): Promise<AgentKeypairInfo | null> {
  try {
    const raw = fs.readFileSync(getMetadataPath(), 'utf-8')
    return JSON.parse(raw) as AgentKeypairInfo
  } catch {
    return null
  }
}

export async function generateAgentKeypair(): Promise<AgentKeypairInfo> {
  const existing = await loadAgentKeypair()
  if (existing) {
    // 如果有元数据但没有加密私钥，尝试迁移旧格式
    if (!loadSecret()) {
      // Distinguish "encrypted file missing" from "encrypted file exists but decrypt failed"
      const encryptedFileExists = fs.existsSync(getEncryptedSecretPath())
      if (encryptedFileExists) {
        // The secret file is present but decryption failed (transient OS/keychain issue).
        // Do NOT delete metadata — the identity is likely still valid.
        throw new Error(
          'Agent secret file exists but could not be decrypted. ' +
          'This is likely a transient OS keychain issue. ' +
          'The existing agent identity has been preserved.',
        )
      }

      const migrated = migrateLegacySecret()
      if (!migrated) {
        // Check if legacy secret file still exists — if so, migration failed
        // (e.g. safeStorage unavailable), not truly orphaned metadata.
        // Preserve identity so the migration can succeed on next launch.
        if (fs.existsSync(getLegacySecretPath())) {
          throw new Error(
            'Legacy agent secret exists but migration to safeStorage failed. ' +
            'This is likely a transient OS issue. ' +
            'The existing agent identity has been preserved.',
          )
        }
        // Orphaned metadata with no recoverable secret — clean up and regenerate
        console.warn('[agent-wallet] orphaned metadata detected, regenerating keypair')
        try { fs.unlinkSync(getMetadataPath()) } catch { /* already gone */ }
        // Fall through to regeneration below
      } else {
        return existing
      }
    } else {
      return existing
    }
  }

  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519')
  const keypair = new Ed25519Keypair()
  const address = keypair.toSuiAddress()
  const publicKey = Buffer.from(keypair.getPublicKey().toRawBytes()).toString('hex')

  // Store secret BEFORE metadata to prevent orphaned state on encryption failure
  const secretKeyHex = Buffer.from(keypair.getSecretKey()).toString('hex')
  storeSecret(secretKeyHex)

  const info: AgentKeypairInfo = { address, publicKey, createdAt: Date.now() }
  const metaPath = getMetadataPath()
  fs.mkdirSync(path.dirname(metaPath), { recursive: true })
  fs.writeFileSync(metaPath, JSON.stringify(info, null, 2))

  return info
}

export async function exportAgentAddress(): Promise<string> {
  const info = await loadAgentKeypair()
  if (!info) throw new Error('Agent keypair not generated')
  return info.address
}

/** 返回私钥存储状态（供 SettingsPanel 显示） */
export function getSecretStorageStatus(): 'encrypted' | 'legacy' | 'missing' {
  if (loadSecret()) return 'encrypted'
  if (fs.existsSync(getLegacySecretPath())) return 'legacy'
  return 'missing'
}

/**
 * Delete every agent-keypair file on disk (metadata + encrypted secret + legacy plaintext).
 *
 * Used by `agentResetIdentity()` to wipe pet identity so a fresh rotation generates a
 * new on-chain address. ENOENT (file already gone) is silently ignored; any other
 * unlink failure (EPERM/EACCES/EBUSY/...) is fatal and re-thrown as an aggregate
 * error. Callers MUST treat a throw here as "reset incomplete" — the metadata file
 * `agent_keypair.json` is the gate `loadAgentKeypair()` reads, so a metadata unlink
 * that silently fails would let `device:start-link` reuse the existing pet identity
 * instead of minting a fresh on-chain agent address. We attempt all three paths
 * before throwing so a single locked file does not skip the others.
 *
 * Does not touch the agent API key or desktop access token — callers must clear
 * those separately.
 */
export function clearAgentKeypair(): void {
  const errors: NodeJS.ErrnoException[] = []
  for (const p of [getMetadataPath(), getEncryptedSecretPath(), getLegacySecretPath()]) {
    try {
      fs.unlinkSync(p)
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e?.code !== 'ENOENT') errors.push(e)
    }
  }
  if (errors.length > 0) {
    const detail = errors
      .map((e) => `${e.code ?? 'UNKNOWN'} ${e.message}`)
      .join('; ')
    throw new Error(`clearAgentKeypair: unlink failed: ${detail}`)
  }
}

/**
 * Sign a personal message with the desktop's agent keypair.
 *
 * - Loads the encrypted secret on demand (and migrates from the legacy JSON
 *   shape if needed).
 * - Reconstructs the Ed25519 keypair from the bech32 secret.
 * - Returns the keypair-produced signature; the keypair is not retained.
 *
 * Failure modes (all fail-closed):
 *   - safeStorage unavailable → typed error.
 *   - Encrypted file present but undecryptable → typed error; metadata is
 *     preserved so the identity can survive a transient OS-keychain failure.
 *   - No secret on disk and no legacy file to migrate → typed error.
 */
export async function signAgentPersonalMessage(message: Uint8Array): Promise<{ signature: string }> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this system')
  }

  let storedSecret: string | null = null
  const encryptedExists = fs.existsSync(getEncryptedSecretPath())
  if (encryptedExists) {
    try {
      const encrypted = fs.readFileSync(getEncryptedSecretPath())
      storedSecret = safeStorage.decryptString(encrypted)
    } catch {
      // Defensive: do not delete metadata or the encrypted blob — a transient
      // keychain hiccup should not destroy the identity.
      throw new Error('Agent secret encrypted but could not be decrypted')
    }
  }

  if (!storedSecret) {
    storedSecret = migrateLegacySecret()
  }

  if (!storedSecret) {
    throw new Error('Agent secret unavailable')
  }

  const bech32 = decodeStoredSecret(storedSecret)
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519')
  const keypair = Ed25519Keypair.fromSecretKey(bech32)
  const { signature } = await keypair.signPersonalMessage(message)
  return { signature }
}
