/**
 * E2E Test: Agent Seal Decrypt via Soulidity Grant system
 *
 * 1. GET /api/agent/souls/{id}/access → Seal access payload
 * 2. Download encrypted blob from Walrus
 * 3. Build Soulidity seal_approve TX (seal_approve_owner or seal_approve_granted_agent)
 * 4. Create SealClient + SessionKey, sign with agent keypair
 * 5. Decrypt DEK via Seal, then AES-GCM decrypt the blob
 * 6. SHA-256 verify decrypted content
 *
 * Soulidity seal_policy entry functions:
 *   seal_approve_owner(id: vector<u8>, state: &SoulState, soul_id: ID, ctx)
 *   seal_approve_granted_agent(id: vector<u8>, state: &SoulState, soul_id: ID, grant: &SoulGrant, clock: &Clock, ctx)
 *
 * Usage:
 *   AGENT_MNEMONIC="..." AGENT_API_KEY="sk-..." SOUL_ID="..." \
 *   [BASE_URL=http://localhost:3100] \
 *   npx tsx web/scripts/e2e-agent-decrypt.ts
 */

import { createHash } from 'node:crypto'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import { SealClient, SessionKey } from '@mysten/seal'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100'
const AGENT_MNEMONIC = process.env.AGENT_MNEMONIC
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY
const AGENT_API_KEY = process.env.AGENT_API_KEY!
const SOUL_ID = process.env.SOUL_ID!
const SUI_NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet') as 'mainnet' | 'testnet' | 'devnet'

const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(SUI_NETWORK), network: SUI_NETWORK })

// --- Seal envelope helpers (inline to avoid legacy imports) ---

function hexToBytes(value: string): Uint8Array {
  const hex = value.startsWith('0x') ? value.slice(2) : value
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function padBase64(value: string): string {
  const r = value.length % 4
  return r === 0 ? value : value + '='.repeat(4 - r)
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(padBase64(value), 'base64'))
}

// Matches SealEnvelopeSidecar from web/lib/services/seal-crypto.ts
interface SealSidecar {
  version: 1
  mode: 'seal-envelope'
  documentId: string
  encryptedDek: string
  iv: string
  cipher: 'AES-GCM-256'
  mimeType: string
  fileName: string
  contentHash: string
}

function parseSidecar(value: unknown): SealSidecar {
  const v = value as Record<string, unknown>
  if (v.version !== 1 || v.mode !== 'seal-envelope') {
    throw new Error(`Unexpected sidecar version/mode: version=${v.version} mode=${v.mode}`)
  }
  if (!v.documentId || !v.encryptedDek || !v.iv || !v.contentHash) {
    throw new Error('Seal sidecar is missing required fields')
  }
  return {
    version: 1,
    mode: 'seal-envelope',
    documentId: v.documentId as string,
    encryptedDek: v.encryptedDek as string,
    iv: v.iv as string,
    cipher: (v.cipher as string) as 'AES-GCM-256',
    mimeType: (v.mimeType as string) ?? '',
    fileName: (v.fileName as string) ?? '',
    contentHash: (v.contentHash as string).toLowerCase(),
  }
}

// --- Build Seal approval TX for Soulidity functions ---

interface AccessPolicy {
  packageId: string
  soulObjectId: string
  stateObjectId: string
  moduleName: string
  functionName: string
  soulGrantObjectId: string | null
}

function buildSealApprovalTx(accessPolicy: AccessPolicy, documentId: string): Transaction {
  const tx = new Transaction()
  const target = `${accessPolicy.packageId}::${accessPolicy.moduleName}::${accessPolicy.functionName}`
  const docIdArg = tx.pure.vector('u8', Array.from(hexToBytes(documentId)))

  if (accessPolicy.functionName === 'seal_approve_owner') {
    // seal_approve_owner(id, state, soul_id, ctx)
    tx.moveCall({
      target,
      arguments: [
        docIdArg,
        tx.object(accessPolicy.stateObjectId),
        tx.pure.id(accessPolicy.soulObjectId),
      ],
    })
  } else if (accessPolicy.functionName === 'seal_approve_granted_agent') {
    // seal_approve_granted_agent(id, state, soul_id, grant, clock, ctx)
    if (!accessPolicy.soulGrantObjectId) {
      throw new Error('soulGrantObjectId is required for seal_approve_granted_agent')
    }
    tx.moveCall({
      target,
      arguments: [
        docIdArg,
        tx.object(accessPolicy.stateObjectId),
        tx.pure.id(accessPolicy.soulObjectId),
        tx.object(accessPolicy.soulGrantObjectId),
        tx.object('0x6'), // Clock object
      ],
    })
  } else {
    throw new Error(`Unknown Seal approval function: ${accessPolicy.functionName}`)
  }

  return tx
}

// --- AES-GCM decrypt ---

async function aesGcmDecrypt(encryptedData: Uint8Array, dek: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const dekBuf = dek.buffer.slice(dek.byteOffset, dek.byteOffset + dek.byteLength) as ArrayBuffer
  const key = await crypto.subtle.importKey('raw', dekBuf, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer
  const dataBuf = encryptedData.buffer.slice(encryptedData.byteOffset, encryptedData.byteOffset + encryptedData.byteLength) as ArrayBuffer
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuf }, key, dataBuf)
  return new Uint8Array(plaintext)
}

async function main() {
  if ((!AGENT_MNEMONIC && !AGENT_PRIVATE_KEY) || !AGENT_API_KEY || !SOUL_ID) {
    console.error('Usage: AGENT_MNEMONIC=... (or AGENT_PRIVATE_KEY=suiprivkey1...) AGENT_API_KEY=... SOUL_ID=... npx tsx web/scripts/e2e-agent-decrypt.ts')
    process.exit(1)
  }

  const keypair = AGENT_PRIVATE_KEY
    ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(AGENT_PRIVATE_KEY).secretKey)
    : Ed25519Keypair.deriveKeypair(AGENT_MNEMONIC!)
  const agentAddress = keypair.toSuiAddress()
  console.log(`Agent address: ${agentAddress}`)
  console.log(`Target: ${BASE_URL}`)

  // Step 1: Get access info
  console.log('\n--- Step 1: Get access info ---')
  const accessRes = await fetch(`${BASE_URL}/api/agent/souls/${encodeURIComponent(SOUL_ID)}/access`, {
    headers: {
      'Authorization': `Bearer ${AGENT_API_KEY}`,
      'x-forwarded-for': '127.0.0.1',
    },
  })

  if (!accessRes.ok) {
    const err = await accessRes.json().catch(() => ({}))
    throw new Error(`Access failed (${accessRes.status}): ${JSON.stringify(err)}`)
  }

  const access = await accessRes.json()
  const sidecar = parseSidecar(access.sealSidecar)
  const accessPolicy = access.accessPolicy as AccessPolicy
  console.log(`Access kind: ${access.accessKind}`)
  console.log(`Policy: ${accessPolicy.functionName}`)
  console.log(`Blob URL: ${access.artifact.walrusBlobUrl}`)
  console.log(`Content hash: ${sidecar.contentHash}`)

  // Step 2: Download encrypted blob
  console.log('\n--- Step 2: Download encrypted blob ---')
  const blobRes = await fetch(access.artifact.walrusBlobUrl)
  if (!blobRes.ok) {
    throw new Error(`Blob download failed: ${blobRes.status}`)
  }
  const encryptedBytes = new Uint8Array(await blobRes.arrayBuffer())
  console.log(`Downloaded ${encryptedBytes.length} bytes`)

  // Step 3: Build Seal approval TX
  console.log('\n--- Step 3: Build Seal approval TX ---')
  const approvalTx = buildSealApprovalTx(accessPolicy, sidecar.documentId)
  const txBytes = await approvalTx.build({ client: suiClient, onlyTransactionKind: true })
  console.log(`Approval TX: ${txBytes.length} bytes`)

  // Step 4: Create SealClient + SessionKey
  console.log('\n--- Step 4: Create Seal session ---')
  const sealClient = new SealClient({
    suiClient,
    serverConfigs: access.seal.serverConfigs,
    verifyKeyServers: access.seal.verifyKeyServers,
  })

  const sessionKey = await SessionKey.create({
    address: agentAddress,
    packageId: accessPolicy.packageId,
    ttlMin: access.sessionTtlMin ?? 10,
    suiClient,
  })

  const personalMsg = sessionKey.getPersonalMessage()
  const { signature: personalMsgSig } = await keypair.signPersonalMessage(personalMsg)
  await sessionKey.setPersonalMessageSignature(personalMsgSig)
  console.log('Session key created and signed')

  // Step 5: Decrypt DEK via Seal, then AES-GCM decrypt content
  console.log('\n--- Step 5: Seal decrypt ---')
  const keyMaterial = new Uint8Array(
    await sealClient.decrypt({
      data: base64ToBytes(sidecar.encryptedDek),
      sessionKey,
      txBytes,
    }),
  )

  const DEK_BYTES = 32
  const CONTENT_HASH_BYTES = 32
  if (keyMaterial.length !== DEK_BYTES + CONTENT_HASH_BYTES) {
    throw new Error(`Unexpected key material length: ${keyMaterial.length} (expected ${DEK_BYTES + CONTENT_HASH_BYTES})`)
  }

  const dek = keyMaterial.subarray(0, DEK_BYTES)
  const boundContentHashBytes = keyMaterial.subarray(DEK_BYTES)
  const boundContentHash = Array.from(boundContentHashBytes, b => b.toString(16).padStart(2, '0')).join('')

  if (boundContentHash !== sidecar.contentHash) {
    throw new Error(`Content hash binding mismatch: ${boundContentHash} !== ${sidecar.contentHash}`)
  }

  const iv = base64ToBytes(sidecar.iv)
  const decryptedData = await aesGcmDecrypt(encryptedBytes, dek, iv)
  console.log(`Decrypted ${decryptedData.length} bytes`)

  // Step 6: Verify content hash
  console.log('\n--- Step 6: Verify content hash ---')
  const hash = createHash('sha256').update(decryptedData).digest('hex')
  console.log(`Computed: ${hash}`)
  console.log(`Expected: ${sidecar.contentHash}`)

  if (hash === sidecar.contentHash) {
    console.log('\n✅ Seal decrypt round-trip verified! Content hash matches.')
  } else {
    console.log('\n❌ Content hash MISMATCH!')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
