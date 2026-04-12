import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

const PUBLIC_METADATA_FILE = 'agent_keypair.json'

export interface AgentKeypairInfo {
  address: string
  publicKey: string
  createdAt: number
}

function getMetadataPath(): string {
  return path.join(app.getPath('userData'), 'state', PUBLIC_METADATA_FILE)
}

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
  if (existing) return existing

  // Dynamic import to avoid top-level dependency issues
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519')
  const keypair = new Ed25519Keypair()
  const address = keypair.toSuiAddress()
  const publicKey = Buffer.from(keypair.getPublicKey().toRawBytes()).toString('hex')

  // For Phase 1, store keypair data locally
  // Phase 2 will migrate to keytar for OS keychain storage
  const info: AgentKeypairInfo = { address, publicKey, createdAt: Date.now() }
  const metaPath = getMetadataPath()
  fs.mkdirSync(path.dirname(metaPath), { recursive: true })
  fs.writeFileSync(metaPath, JSON.stringify(info, null, 2))

  // Store secret key alongside for Phase 1 (Phase 2 migrates to keytar)
  const secretPath = path.join(path.dirname(metaPath), 'agent_secret.json')
  fs.writeFileSync(secretPath, JSON.stringify({
    secretKey: Buffer.from(keypair.getSecretKey()).toString('hex'),
  }))

  return info
}

export async function exportAgentAddress(): Promise<string> {
  const info = await loadAgentKeypair()
  if (!info) throw new Error('Agent keypair not generated')
  return info.address
}
