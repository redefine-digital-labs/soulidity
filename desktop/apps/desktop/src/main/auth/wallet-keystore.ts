import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, safeStorage } from 'electron'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

const PUBLIC_METADATA_FILE = 'user_wallet.json'
const ENCRYPTED_SECRET_FILE = 'user_wallet_secret.enc'

export interface WalletInfo {
  address: string
  publicKey: string
  createdAt: number
}

class SafeStorageUnavailableError extends Error {
  constructor() {
    super(
      'OS keychain encryption is unavailable. Cannot store wallet secret. ' +
      'On Linux, install libsecret. On macOS/Windows the keychain should be available by default.',
    )
    this.name = 'SafeStorageUnavailableError'
  }
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

function ensureSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SafeStorageUnavailableError()
  }
}

function storeBech32Secret(suiPrivKey: string): void {
  ensureSafeStorage()
  const encrypted = safeStorage.encryptString(suiPrivKey)
  const dir = getStatePath()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getEncryptedSecretPath(), encrypted)
}

function loadBech32Secret(): string | null {
  if (!fs.existsSync(getEncryptedSecretPath())) return null
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SafeStorageUnavailableError()
  }
  try {
    const encrypted = fs.readFileSync(getEncryptedSecretPath())
    return safeStorage.decryptString(encrypted)
  } catch (error) {
    console.error('[wallet-keystore] failed to decrypt secret', error)
    throw new Error('Saved wallet secret could not be decrypted. The OS keychain may be locked.')
  }
}

function persistMetadata(info: WalletInfo): void {
  const metaPath = getMetadataPath()
  fs.mkdirSync(path.dirname(metaPath), { recursive: true })
  fs.writeFileSync(metaPath, JSON.stringify(info, null, 2))
}

function readMetadata(): WalletInfo | null {
  try {
    const raw = fs.readFileSync(getMetadataPath(), 'utf-8')
    return JSON.parse(raw) as WalletInfo
  } catch {
    return null
  }
}

function loadKeypair(): Ed25519Keypair | null {
  const bech32 = loadBech32Secret()
  if (!bech32) return null
  const { secretKey } = decodeSuiPrivateKey(bech32)
  return Ed25519Keypair.fromSecretKey(secretKey)
}

function loadKeypairOrThrow(): Ed25519Keypair {
  const keypair = loadKeypair()
  if (!keypair) {
    throw new Error('No wallet has been generated or imported yet')
  }
  return keypair
}

function infoFromKeypair(keypair: Ed25519Keypair, createdAt: number): WalletInfo {
  return {
    address: keypair.toSuiAddress(),
    publicKey: Buffer.from(keypair.getPublicKey().toRawBytes()).toString('hex'),
    createdAt,
  }
}

function decodeEd25519SecretKey(raw: string, sourceLabel = 'private key'): Ed25519Keypair {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error(`${sourceLabel} is empty`)
  }

  if (trimmed.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(trimmed)
    return Ed25519Keypair.fromSecretKey(secretKey)
  }

  try {
    const bytes = Buffer.from(trimmed, 'base64')
    if (bytes.length === 32 || bytes.length === 64) {
      return Ed25519Keypair.fromSecretKey(bytes.slice(0, 32))
    }
  } catch {
    // Try hex below.
  }

  const hexBytes = Buffer.from(trimmed, 'hex')
  if (hexBytes.length === 32 || hexBytes.length === 64) {
    return Ed25519Keypair.fromSecretKey(hexBytes.slice(0, 32))
  }

  throw new Error(`${sourceLabel} must be a valid Sui private key (bech32, base64, or hex)`)
}

// ── Public API ───────────────────────────────────────────

export function getWalletInfo(): WalletInfo | null {
  const meta = readMetadata()
  if (!meta) return null
  // Verify the secret is still readable. If it isn't, treat the wallet as
  // missing so callers prompt the user to regenerate or re-import.
  try {
    if (!loadBech32Secret()) return null
  } catch {
    return null
  }
  return meta
}

export function generateWallet(): WalletInfo {
  ensureSafeStorage()
  const keypair = new Ed25519Keypair()
  storeBech32Secret(keypair.getSecretKey())
  const info = infoFromKeypair(keypair, Date.now())
  persistMetadata(info)
  return info
}

export function importWallet(secretKeyInput: string): WalletInfo {
  ensureSafeStorage()
  const keypair = decodeEd25519SecretKey(secretKeyInput, 'wallet private key')
  storeBech32Secret(keypair.getSecretKey())
  const info = infoFromKeypair(keypair, Date.now())
  persistMetadata(info)
  return info
}

export function resetWallet(): void {
  for (const filePath of [getMetadataPath(), getEncryptedSecretPath()]) {
    try {
      fs.unlinkSync(filePath)
    } catch {
      // ignore — already missing
    }
  }
}

export async function signPersonalMessage(message: Uint8Array): Promise<{ signature: string }> {
  const keypair = loadKeypairOrThrow()
  const result = await keypair.signPersonalMessage(message)
  return { signature: result.signature }
}

export async function signTransactionBytes(rawBytes: Uint8Array): Promise<{ signature: string }> {
  const keypair = loadKeypairOrThrow()
  const result = await keypair.signTransaction(rawBytes)
  return { signature: result.signature }
}
