import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

export function loadKeypairFromEnv(envName: string): Ed25519Keypair {
  const raw = process.env[envName]?.trim()
  if (!raw) {
    throw new Error(`${envName} is required`)
  }

  if (raw.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(raw)
    return Ed25519Keypair.fromSecretKey(secretKey)
  }

  try {
    const bytes = Buffer.from(raw, 'base64')
    if (bytes.length === 32 || bytes.length === 64) {
      return Ed25519Keypair.fromSecretKey(bytes.slice(0, 32))
    }
  } catch { /* ignore */ }

  const hexBytes = Buffer.from(raw, 'hex')
  if (hexBytes.length === 32 || hexBytes.length === 64) {
    return Ed25519Keypair.fromSecretKey(hexBytes.slice(0, 32))
  }

  throw new Error(`${envName} must be a valid Sui private key (bech32, base64, or hex)`)
}
