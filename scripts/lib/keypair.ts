import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

/**
 * Parse a Sui Ed25519 secret key from a user-supplied string. Accepted forms:
 *  - bech32 `suiprivkey1...`
 *  - base64 (32 or 64 bytes)
 *  - hex (32 or 64 bytes)
 *
 * Throws if the input cannot be decoded into a valid 32-byte secret.
 */
export function decodeEd25519SecretKey(raw: string, sourceLabel = 'private key'): Ed25519Keypair {
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
  } catch { /* ignore */ }

  const hexBytes = Buffer.from(trimmed, 'hex')
  if (hexBytes.length === 32 || hexBytes.length === 64) {
    return Ed25519Keypair.fromSecretKey(hexBytes.slice(0, 32))
  }

  throw new Error(`${sourceLabel} must be a valid Sui private key (bech32, base64, or hex)`)
}

export function loadKeypairFromEnv(envName: string): Ed25519Keypair {
  const raw = process.env[envName]?.trim()
  if (!raw) {
    throw new Error(`${envName} is required`)
  }
  return decodeEd25519SecretKey(raw, envName)
}
