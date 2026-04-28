/**
 * E2E Content Verification:
 * Agent access API -> Walrus download -> direct AES-GCM decrypt -> byte compare.
 *
 * Preferred multi-artifact usage:
 *   SOUL_ID="0x..." \
 *   AGENT_API_KEY="sk-..." \
 *   PENDING_SEAL_MATERIALS_JSON='{"char":{"dek":"...","iv":"...","contentHash":"...","mimeType":"text/markdown","fileName":"soul.md"}}' \
 *   MEMORY_ENTRY_KEY="..." \
 *   SKILL_NAME="default" \
 *   SKILL_VERSION_INDEX="0" \
 *   COMPARE_DIR="/Users/admin/Documents/example" \
 *   npx tsx web/scripts/e2e-agent-verify-content.ts
 *
 * Single-artifact usage:
 *   PENDING_SEAL_MATERIAL='{"dek":"...","iv":"...","contentHash":"...","mimeType":"text/markdown","fileName":"soul.md"}' COMPARE_FILE="soul.md" ...
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import { SealClient, SessionKey } from '@mysten/seal'

const SOUL_ID = process.env.SOUL_ID!
const AGENT_API_KEY = process.env.AGENT_API_KEY!
const AGENT_MNEMONIC = process.env.AGENT_MNEMONIC
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100'
const COMPARE_DIR = process.env.COMPARE_DIR!
const SUI_NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet') as 'mainnet' | 'testnet' | 'devnet'
const SUI_CLOCK_OBJECT_ID = '0x6'

const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(SUI_NETWORK), network: SUI_NETWORK })

type ArtifactKind = 'char' | 'memory' | 'skills' | 'sprite'

interface PendingSealMaterial {
  dek: string
  iv: string
  contentHash: string
  mimeType: string
  fileName: string
}

type PendingSealMaterialMap = Partial<Record<ArtifactKind, PendingSealMaterial | null>>

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

interface AccessPolicy {
  packageId: string
  moduleName: string
  functionName: string
  stateObjectId: string
  soulObjectId?: string
  soulGrantObjectId?: string | null
  documentIdHex?: string
  memoryObjectId?: string
  timestampKey?: string | number
  skillsObjectId?: string
  skillName?: string
  versionIndex?: string | number
  assetsObjectId?: string
  assetName?: string
  accessListOnChainId?: string
}

const DEFAULT_COMPARE_FILES: Record<ArtifactKind, string> = {
  char: 'soul.md',
  memory: 'memory.md',
  skills: 'skill.zip',
  sprite: 'sprite.png',
}

/* ---- AES-GCM decrypt ---- */

async function aesGcmDecrypt(data: Uint8Array, dek: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    dek as unknown as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, key, data as unknown as ArrayBuffer),
  )
}

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

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, b => b.toString(16).padStart(2, '0')).join('')
}

function readJsonEnv<T>(name: string): T | null {
  const raw = process.env[name]
  if (!raw?.trim()) return null
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function resolveMaterialMap(): PendingSealMaterialMap | null {
  const map = readJsonEnv<PendingSealMaterialMap>('PENDING_SEAL_MATERIALS_JSON')
  if (map) return map

  const singleMaterial = readJsonEnv<PendingSealMaterial>('PENDING_SEAL_MATERIAL')
  if (!singleMaterial) return null
  return { char: singleMaterial }
}

function resolveCompareFiles() {
  const compareMap = readJsonEnv<Partial<Record<ArtifactKind, string>>>('COMPARE_MAP_JSON') ?? {}
  if (process.env.COMPARE_FILE?.trim()) {
    compareMap.char = process.env.COMPARE_FILE.trim()
  }
  return compareMap
}

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function resolveKinds(materialMap: PendingSealMaterialMap | null): ArtifactKind[] {
  if (materialMap) {
    return (Object.keys(DEFAULT_COMPARE_FILES) as ArtifactKind[])
      .filter((kind) => Boolean(materialMap[kind]))
  }

  const requested = process.env.VERIFY_KINDS?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) as ArtifactKind[] | undefined
  if (requested?.length) return requested

  return ['char', 'memory', 'skills']
}

function endpointFor(kind: ArtifactKind) {
  switch (kind) {
    case 'char':
      return `/api/agent/souls/${encodeURIComponent(SOUL_ID)}/access`
    case 'memory':
      return `/api/agent/souls/${encodeURIComponent(SOUL_ID)}/memory/${encodeURIComponent(requireEnv('MEMORY_ENTRY_KEY'))}/access`
    case 'skills':
      return `/api/agent/souls/${encodeURIComponent(SOUL_ID)}/skills/${encodeURIComponent(requireEnv('SKILL_NAME'))}/versions/${encodeURIComponent(requireEnv('SKILL_VERSION_INDEX'))}/access`
    case 'sprite':
      return `/api/agent/souls/${encodeURIComponent(SOUL_ID)}/assets/${encodeURIComponent(process.env.ASSET_NAME ?? 'persona-sprite')}/versions/${encodeURIComponent(process.env.ASSET_VERSION_INDEX ?? '0')}/access`
  }
}

async function fetchAccessPayload(kind: ArtifactKind) {
  const accessRes = await fetch(`${BASE_URL}${endpointFor(kind)}`, {
    headers: { Authorization: `Bearer ${AGENT_API_KEY}`, 'x-forwarded-for': '127.0.0.1' },
  })
  const access = await accessRes.json().catch(() => null)
  if (!accessRes.ok) {
    throw new Error(`${kind} access API failed (${accessRes.status}): ${JSON.stringify(access)}`)
  }
  if (!access?.artifact?.walrusBlobUrl) {
    throw new Error(`${kind} access payload did not include artifact.walrusBlobUrl`)
  }
  return access
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

function getAgentKeypair() {
  if (AGENT_PRIVATE_KEY) {
    return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(AGENT_PRIVATE_KEY).secretKey)
  }
  if (AGENT_MNEMONIC) {
    return Ed25519Keypair.deriveKeypair(AGENT_MNEMONIC)
  }
  throw new Error('AGENT_PRIVATE_KEY or AGENT_MNEMONIC is required when PENDING_SEAL_MATERIALS_JSON is not provided')
}

function buildSealApprovalTx(accessPolicy: AccessPolicy, documentId: string, viewerAddress?: string): Transaction {
  const tx = new Transaction()
  if (viewerAddress) tx.setSender(viewerAddress)

  const target = `${accessPolicy.packageId}::${accessPolicy.moduleName}::${accessPolicy.functionName}`
  const docIdArg = tx.pure.vector('u8', Array.from(hexToBytes(accessPolicy.documentIdHex ?? documentId)))
  let args = [docIdArg, tx.object(accessPolicy.stateObjectId)]

  switch (accessPolicy.functionName) {
    case 'seal_approve_owner':
      args = [...args, tx.pure.id(accessPolicy.soulObjectId ?? SOUL_ID)]
      break
    case 'seal_approve_granted_agent':
      args = [
        ...args,
        tx.pure.id(accessPolicy.soulObjectId ?? SOUL_ID),
        tx.object(requirePolicyObject(accessPolicy.soulGrantObjectId, 'soulGrantObjectId')),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ]
      break
    case 'seal_approve_memory_owner':
      args = [
        ...args,
        tx.object(requirePolicyObject(accessPolicy.memoryObjectId, 'memoryObjectId')),
        tx.pure.u64(requirePolicyNumber(accessPolicy.timestampKey, 'timestampKey')),
      ]
      break
    case 'seal_approve_memory_granted_agent':
      args = [
        ...args,
        tx.object(requirePolicyObject(accessPolicy.memoryObjectId, 'memoryObjectId')),
        tx.pure.u64(requirePolicyNumber(accessPolicy.timestampKey, 'timestampKey')),
        tx.object(requirePolicyObject(accessPolicy.soulGrantObjectId, 'soulGrantObjectId')),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ]
      break
    case 'seal_approve_private_read_owner':
      args = [
        ...args,
        tx.object(requirePolicyObject(accessPolicy.skillsObjectId, 'skillsObjectId')),
        tx.pure.string(requirePolicyObject(accessPolicy.skillName, 'skillName')),
        tx.pure.u64(requirePolicyNumber(accessPolicy.versionIndex, 'versionIndex')),
      ]
      break
    case 'seal_approve_private_read_granted_agent':
      args = [
        ...args,
        tx.object(requirePolicyObject(accessPolicy.skillsObjectId, 'skillsObjectId')),
        tx.pure.string(requirePolicyObject(accessPolicy.skillName, 'skillName')),
        tx.pure.u64(requirePolicyNumber(accessPolicy.versionIndex, 'versionIndex')),
        tx.object(requirePolicyObject(accessPolicy.soulGrantObjectId, 'soulGrantObjectId')),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ]
      break
    case 'seal_approve_asset_read_owner':
      args = [
        ...args,
        tx.object(requirePolicyObject(accessPolicy.assetsObjectId, 'assetsObjectId')),
        tx.pure.string(requirePolicyObject(accessPolicy.assetName, 'assetName')),
        tx.pure.u64(requirePolicyNumber(accessPolicy.versionIndex, 'versionIndex')),
      ]
      break
    case 'seal_approve_asset_read_granted_agent':
      args = [
        ...args,
        tx.object(requirePolicyObject(accessPolicy.assetsObjectId, 'assetsObjectId')),
        tx.pure.string(requirePolicyObject(accessPolicy.assetName, 'assetName')),
        tx.pure.u64(requirePolicyNumber(accessPolicy.versionIndex, 'versionIndex')),
        tx.object(requirePolicyObject(accessPolicy.soulGrantObjectId, 'soulGrantObjectId')),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ]
      break
    default:
      throw new Error(`Unsupported Seal approval function: ${accessPolicy.functionName}`)
  }

  tx.moveCall({ target, arguments: args })
  return tx
}

function requirePolicyObject(value: string | null | undefined, name: string): string {
  if (!value) throw new Error(`accessPolicy.${name} is required`)
  return value
}

function requirePolicyNumber(value: string | number | null | undefined, name: string): string | number {
  if (value == null || value === '') throw new Error(`accessPolicy.${name} is required`)
  return value
}

function compareBytes(kind: ArtifactKind, decrypted: Uint8Array, comparePath: string) {
  const original = new Uint8Array(readFileSync(comparePath))
  const originalHash = createHash('sha256').update(original).digest('hex')
  const decryptedHash = createHash('sha256').update(decrypted).digest('hex')
  if (originalHash !== decryptedHash) {
    throw new Error(
      `${kind} byte mismatch: original=${original.length}B sha256=${originalHash}, decrypted=${decrypted.length}B sha256=${decryptedHash}`,
    )
  }
  console.log(`OK ${kind}: ${comparePath} (${original.length} bytes, sha256=${originalHash})`)
}

function findComparePath(kind: ArtifactKind, envelopeFileName: string, compareFile?: string) {
  const candidates = [
    compareFile,
    DEFAULT_COMPARE_FILES[kind],
    envelopeFileName,
  ].filter((value): value is string => Boolean(value?.trim()))

  for (const candidate of candidates) {
    const fullPath = join(COMPARE_DIR, candidate)
    try {
      readFileSync(fullPath)
      return fullPath
    } catch {
      // Try next candidate.
    }
  }

  const files = readdirSync(COMPARE_DIR).filter((file) => !file.startsWith('.'))
  const matchingExtension = files.find((file) => extname(file) && extname(file) === extname(envelopeFileName))
  if (matchingExtension) return join(COMPARE_DIR, matchingExtension)

  throw new Error(`${kind} compare file not found in ${COMPARE_DIR}; tried ${candidates.join(', ')}`)
}

function materialToBytes(material: PendingSealMaterial) {
  return {
    dek: new Uint8Array(Buffer.from(material.dek, 'base64')),
    iv: new Uint8Array(Buffer.from(material.iv, 'base64')),
    contentHash: material.contentHash,
    mimeType: material.mimeType,
    fileName: material.fileName,
  }
}

async function verifyArtifact(kind: ArtifactKind, material: PendingSealMaterial, compareFile?: string) {
  console.log(`\n--- ${kind} ---`)
  const access = await fetchAccessPayload(kind)
  console.log(`accessKind=${access.accessKind ?? access.visibility ?? 'unknown'}`)
  console.log(`blob=${access.artifact.walrusBlobUrl}`)

  const envelope = materialToBytes(material)
  console.log(`material file=${envelope.fileName} mime=${envelope.mimeType}`)

  const blobRes = await fetch(access.artifact.walrusBlobUrl)
  if (!blobRes.ok) throw new Error(`${kind} blob download failed: ${blobRes.status}`)
  const encryptedBytes = new Uint8Array(await blobRes.arrayBuffer())
  const decrypted = await aesGcmDecrypt(encryptedBytes, envelope.dek, envelope.iv)

  const contentHash = createHash('sha256').update(decrypted).digest('hex')
  if (contentHash !== envelope.contentHash) {
    throw new Error(`${kind} content hash mismatch: computed=${contentHash}, envelope=${envelope.contentHash}`)
  }

  const comparePath = findComparePath(kind, envelope.fileName, compareFile)
  compareBytes(kind, decrypted, comparePath)
}

async function verifyArtifactWithSeal(kind: ArtifactKind, compareFile?: string) {
  console.log(`\n--- ${kind} ---`)
  const access = await fetchAccessPayload(kind)
  console.log(`accessKind=${access.accessKind ?? access.visibility ?? 'unknown'}`)
  console.log(`blob=${access.artifact.walrusBlobUrl}`)

  const sidecar = parseSidecar(access.sealSidecar)
  console.log(`sidecar file=${sidecar.fileName} mime=${sidecar.mimeType}`)

  const keypair = getAgentKeypair()
  const agentAddress = keypair.toSuiAddress()
  const sessionKey = await SessionKey.create({
    address: agentAddress,
    packageId: access.accessPolicy.packageId,
    ttlMin: access.sessionTtlMin ?? 10,
    suiClient,
  })
  const { signature } = await keypair.signPersonalMessage(sessionKey.getPersonalMessage())
  await sessionKey.setPersonalMessageSignature(signature)

  const approvalTx = buildSealApprovalTx(access.accessPolicy, sidecar.documentId, access.viewerAddress)
  const txBytes = await approvalTx.build({ client: suiClient, onlyTransactionKind: true })
  const sealClient = new SealClient({
    suiClient,
    serverConfigs: access.seal.serverConfigs,
    verifyKeyServers: access.seal.verifyKeyServers,
  })

  const keyMaterial = new Uint8Array(await sealClient.decrypt({
    data: base64ToBytes(sidecar.encryptedDek),
    sessionKey,
    txBytes,
  }))
  try {
    const DEK_BYTES = 32
    const CONTENT_HASH_BYTES = 32
    if (keyMaterial.length !== DEK_BYTES + CONTENT_HASH_BYTES) {
      throw new Error(`Unexpected key material length: ${keyMaterial.length}`)
    }
    const dek = keyMaterial.subarray(0, DEK_BYTES)
    const boundContentHash = bytesToHex(keyMaterial.subarray(DEK_BYTES)).toLowerCase()
    if (boundContentHash !== sidecar.contentHash) {
      throw new Error(`${kind} content hash binding mismatch: ${boundContentHash} !== ${sidecar.contentHash}`)
    }

    const blobRes = await fetch(access.artifact.walrusBlobUrl)
    if (!blobRes.ok) throw new Error(`${kind} blob download failed: ${blobRes.status}`)
    const encryptedBytes = new Uint8Array(await blobRes.arrayBuffer())
    const decrypted = await aesGcmDecrypt(encryptedBytes, dek, base64ToBytes(sidecar.iv))
    if (createHash('sha256').update(decrypted).digest('hex') !== sidecar.contentHash) {
      throw new Error(`${kind} content hash mismatch after decrypt`)
    }
    const comparePath = findComparePath(kind, sidecar.fileName, compareFile)
    compareBytes(kind, decrypted, comparePath)
  } finally {
    keyMaterial.fill(0)
  }
}

async function main() {
  if (!SOUL_ID || !AGENT_API_KEY || !COMPARE_DIR) {
    throw new Error('Missing env vars: SOUL_ID, AGENT_API_KEY, COMPARE_DIR')
  }

  const materialMap = resolveMaterialMap()
  const compareFiles = resolveCompareFiles()
  const kinds = resolveKinds(materialMap)

  if (kinds.length === 0) {
    throw new Error('No artifacts selected for verification')
  }

  for (const kind of kinds) {
    if (materialMap?.[kind]) {
      await verifyArtifact(kind, materialMap[kind]!, compareFiles[kind])
    } else {
      await verifyArtifactWithSeal(kind, compareFiles[kind])
    }
  }

  console.log(`\nOK ${kinds.length} artifact(s) matched byte-for-byte.`)
}

main().catch((error) => {
  console.error('Fatal:', error instanceof Error ? error.message : error)
  process.exit(1)
})
