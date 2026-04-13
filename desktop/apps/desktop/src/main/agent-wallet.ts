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
