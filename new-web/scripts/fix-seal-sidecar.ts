/**
 * One-off fix: convert raw DEK envelope string → proper SealEnvelopeSidecar JSON
 *
 * Usage:
 *   source .env && SOUL_ON_CHAIN_ID="0x..." npx tsx new-web/scripts/fix-seal-sidecar.ts
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import pg from 'pg'
import { SealClient } from '@mysten/seal'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { getConfiguredSoulidityNetwork } from '../lib/soulidity/deployment'
import { getRequiredSoulidityEnv } from '../lib/soulidity/env'

/* ---- inline env ---- */

const SOUL_ON_CHAIN_ID = process.env.SOUL_ON_CHAIN_ID!
const PACKAGE_ID = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
const SUI_NETWORK = getConfiguredSoulidityNetwork() as 'testnet' | 'mainnet'
const DATABASE_URL = process.env.DATABASE_URL!

/* ---- inline Sui client ---- */

const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(SUI_NETWORK), network: SUI_NETWORK })

/* ---- inline unsealDekEnvelope ---- */

function getUploadSecret(): Buffer {
  const hex = process.env.SOUL_UPLOAD_SECRET
  if (!hex || hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('SOUL_UPLOAD_SECRET must be a 64-character hex string')
  }
  return Buffer.from(hex, 'hex')
}

function unsealDekEnvelope(envelope: string) {
  const secret = getUploadSecret()
  const raw = Buffer.from(envelope, 'base64')
  const ENVELOPE_IV = 12, AUTH_TAG = 16
  const headerLength = ENVELOPE_IV + AUTH_TAG
  if (raw.length <= headerLength) throw new Error('DEK envelope is malformed')

  const iv = raw.subarray(0, ENVELOPE_IV)
  const authTag = raw.subarray(ENVELOPE_IV, headerLength)
  const ciphertext = raw.subarray(headerLength)

  const decipher = createDecipheriv('aes-256-gcm', secret, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const payload = JSON.parse(plaintext.toString('utf8'))

  return {
    dek: new Uint8Array(Buffer.from(payload.dek, 'base64')),
    iv: new Uint8Array(Buffer.from(payload.iv, 'base64')),
    contentHash: payload.contentHash as string,
    mimeType: payload.mimeType as string,
    fileName: payload.fileName as string,
  }
}

/* ---- inline seal helpers ---- */

function hexToBytes(value: string): Uint8Array {
  const hex = value.startsWith('0x') ? value.slice(2) : value
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function generateSealDocumentId(soulObjectId: string, nonce?: Uint8Array): string {
  const idBytes = hexToBytes(soulObjectId)
  const nonceBytes = nonce ?? new Uint8Array(16).fill(0x42)
  return bytesToHex(new Uint8Array([
    ...new TextEncoder().encode('soul-content:'),
    1, // version
    ...idBytes,
    ...nonceBytes,
  ]))
}

function createSealKeyMaterial(dek: Uint8Array, contentHashHex: string): Uint8Array {
  const hashBytes = hexToBytes(contentHashHex)
  const material = new Uint8Array(dek.length + hashBytes.length)
  material.set(dek, 0)
  material.set(hashBytes, dek.length)
  return material
}

/* ---- inline getSoulStateObject (minimal) ---- */

async function getStatePackageId(stateObjectId: string): Promise<string> {
  const res = await suiClient.getObject({ id: stateObjectId, options: { showType: true } })
  const type = res.data?.type
  if (!type) throw new Error(`Cannot resolve state object type: ${stateObjectId}`)
  const match = type.match(/^(0x[0-9a-f]+)::/)
  return match ? match[1] : PACKAGE_ID
}

/* ---- main ---- */

async function main() {
  if (!SOUL_ON_CHAIN_ID || !DATABASE_URL) {
    console.error('Usage: source .env && SOUL_ON_CHAIN_ID=0x... npx tsx new-web/scripts/fix-seal-sidecar.ts')
    process.exit(1)
  }

  const pool = new pg.Pool({ connectionString: DATABASE_URL })

  // Step 1: Read current sealSidecar
  console.log('--- Step 1: Read current sealSidecar ---')
  const res = await pool.query(
    'SELECT seal_sidecar, state_on_chain_id FROM soul_assets WHERE on_chain_id = $1',
    [SOUL_ON_CHAIN_ID],
  )
  if (res.rows.length === 0) throw new Error(`Soul not found: ${SOUL_ON_CHAIN_ID}`)

  const { seal_sidecar: currentSidecar, state_on_chain_id: stateId } = res.rows[0]
  console.log(`Current type: ${typeof currentSidecar}`)

  if (typeof currentSidecar === 'object' && currentSidecar?.version === 1) {
    console.log('Already a proper SealEnvelopeSidecar. No fix needed.')
    await pool.end()
    return
  }
  if (typeof currentSidecar !== 'string') {
    throw new Error(`Unexpected sealSidecar type: ${typeof currentSidecar}`)
  }

  // Step 2: Unseal DEK envelope
  console.log('\n--- Step 2: Unseal DEK envelope ---')
  const envelope = unsealDekEnvelope(currentSidecar)
  console.log(`DEK: ${envelope.dek.length}B, IV: ${envelope.iv.length}B`)
  console.log(`Content hash: ${envelope.contentHash}`)
  console.log(`File: ${envelope.fileName} (${envelope.mimeType})`)

  // Step 3: Resolve on-chain package
  console.log('\n--- Step 3: Resolve on-chain package ---')
  const sealPackageId = await getStatePackageId(stateId)
  console.log(`Package: ${sealPackageId}`)

  // Step 4: Create proper SealEnvelopeSidecar
  console.log('\n--- Step 4: Encrypt DEK via Seal ---')
  const sealServerConfigs = [
    { objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', weight: 1 },
  ]

  const sealClient = new SealClient({
    suiClient,
    serverConfigs: sealServerConfigs,
    verifyKeyServers: true,
  })

  const documentId = generateSealDocumentId(SOUL_ON_CHAIN_ID)
  const keyMaterial = createSealKeyMaterial(envelope.dek, envelope.contentHash)

  let encryptedDek: string
  try {
    const { encryptedObject } = await sealClient.encrypt({
      threshold: 1,
      packageId: sealPackageId,
      id: documentId,
      data: keyMaterial,
    })
    encryptedDek = bytesToBase64(new Uint8Array(encryptedObject))
  } finally {
    keyMaterial.fill(0)
    envelope.dek.fill(0)
  }

  const sidecar = {
    version: 1,
    mode: 'seal-envelope',
    documentId,
    encryptedDek,
    iv: bytesToBase64(envelope.iv),
    cipher: 'AES-GCM-256',
    mimeType: envelope.mimeType,
    fileName: envelope.fileName,
    contentHash: envelope.contentHash,
  }

  console.log(`documentId: ${documentId.slice(0, 30)}...`)
  console.log(`encryptedDek length: ${encryptedDek.length}`)

  // Step 5: Update DB
  console.log('\n--- Step 5: Update DB ---')
  await pool.query(
    'UPDATE soul_assets SET seal_sidecar = $1::jsonb WHERE on_chain_id = $2',
    [JSON.stringify(sidecar), SOUL_ON_CHAIN_ID],
  )

  // Verify
  const verify = await pool.query('SELECT seal_sidecar FROM soul_assets WHERE on_chain_id = $1', [SOUL_ON_CHAIN_ID])
  const newSc = verify.rows[0].seal_sidecar
  console.log(`\nVerify: type=${typeof newSc}, version=${newSc?.version}, hasDocId=${!!newSc?.documentId}, hash=${newSc?.contentHash}`)

  console.log('\n\u2705 sealSidecar fixed')
  await pool.end()
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
