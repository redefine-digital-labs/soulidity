/**
 * Batch Soul publisher — reads souls/template.csv, processes each Soul through
 * upload → mint → sync → list → sync-list with per-Soul checkpointing.
 *
 * Usage:
 *   NODE_PATH=web/node_modules npx tsx scripts/batch-publish.ts [--resume] [--dry-run] [--start N] [--only N]
 *
 * Required env (loaded from .env):
 *   BATCH_SIGNER_SECRET_KEY  — Sui Ed25519 secret key (bech32 suiprivkey1..., base64, or hex)
 *   BATCH_API_TOKEN          — Desktop access token (dtk_...) for publish/list sync API auth
 *   BATCH_API_BASE_URL       — Web server URL (e.g. http://localhost:3100)
 *   NEXT_PUBLIC_SUI_NETWORK  — testnet | mainnet
 *   SOUL_UPLOAD_SECRET       — 64-char hex string for DEK envelope sealing
 *
 * Flags:
 *   --resume   Resume from souls/manifest.json (skip completed phases)
 *   --dry-run  Show planned actions without executing
 *   --start N  Start from Soul index N
 *   --only N   Process only Soul index N
 */

import 'dotenv/config'

import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import { zipSync } from 'fflate'

import { loadKeypairFromEnv } from './lib/keypair'

type SuiClient = SuiJsonRpcClient

// ── Paths ──────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOULS_DIR = join(REPO_ROOT, 'souls')
const TEMPLATE_CSV = join(SOULS_DIR, 'template.csv')
const MANIFEST_PATH = join(SOULS_DIR, 'manifest.json')
const DEPLOYMENT_MANIFEST_PATH = join(REPO_ROOT, 'web', 'lib', 'soulidity', 'deployment-manifest.json')

// ── Constants ──────────────────────────────────────────────

const USDC_DECIMALS = 6
const WALRUS_UPLOAD_TIMEOUT_MS = 60_000
const SUI_CLOCK_OBJECT_ID = '0x6'
const WALRUS_BLOB_TYPE = '0xd84704c17fc870b8764832c535aa6b11f21a95cd6f5bb38a9b07d2cf42220c66::blob::Blob'

const TESTNET_PUBLISHER_URLS = [
  'https://publisher.walrus-testnet.walrus.space',
  'https://publisher.walrus-testnet.h2o-nodes.com',
  'https://sui-walrus-testnet-publisher.bwarelabs.com',
]
const MAINNET_PUBLISHER_URL = 'https://publisher.mainnet.walrus.space'

const TESTNET_AGGREGATOR_URL = 'https://aggregator.walrus-testnet.walrus.space'
const MAINNET_AGGREGATOR_URL = 'https://aggregator.mainnet.walrus.mirai.cloud'

// ── Types ──────────────────────────────────────────────────

type Phase = 'pending' | 'uploaded' | 'minted' | 'synced' | 'listed' | 'done'

interface SoulRow {
  index: number
  name: string
  description: string
  tags: string[]
  creatorRoyaltyPct: number
  priceUsdc: number
}

interface UploadResult {
  blobId: string
  blobObjectId: string | null
  contentHash: string
  sealDekEnvelope?: string | null
}

interface SoulManifestEntry {
  index: number
  name: string
  phase: Phase
  // Upload results
  soulUpload?: UploadResult | null
  memoryUpload?: UploadResult | null
  skillUpload?: UploadResult | null
  imageUpload?: UploadResult | null
  skillName?: string | null
  // Mint results
  mintTxDigest?: string | null
  soulOnChainId?: string | null
  stateOnChainId?: string | null
  // Sync results
  synced?: boolean
  // List results
  listTxDigest?: string | null
  listingStatus?: string | null
  error?: string | null
}

interface Manifest {
  createdAt: string
  signerAddress: string
  network: string
  entries: SoulManifestEntry[]
}

interface SoulidityDeployment {
  packageId: string
  marketConfigId: string
  kioskRegistryId: string
  soulTransferPolicyId: string
  collectionTransferPolicyId: string
  paymentCoinType: string
}

// ── Config ─────────────────────────────────────────────────

function getNetwork(): 'testnet' | 'mainnet' {
  const value = process.env.NEXT_PUBLIC_SUI_NETWORK?.trim().toLowerCase()
  return value === 'mainnet' ? 'mainnet' : 'testnet'
}

function getDeployment(): SoulidityDeployment {
  const manifest = JSON.parse(readFileSync(DEPLOYMENT_MANIFEST_PATH, 'utf8'))
  const network = getNetwork()
  const deployment = manifest[network]
  if (!deployment) {
    throw new Error(`No Soulidity deployment found for network: ${network}`)
  }
  return deployment
}

function getApiConfig() {
  const token = process.env.BATCH_API_TOKEN?.trim()
  const baseUrl = process.env.BATCH_API_BASE_URL?.trim()
  if (!token || !baseUrl) {
    throw new Error('BATCH_API_TOKEN and BATCH_API_BASE_URL are required')
  }
  return { token, baseUrl }
}

function getSuiClient(): SuiClient {
  const network = getNetwork()
  return new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network })
}

function getWalrusPublisherUrl(): string {
  const configured = process.env.WALRUS_PUBLISHER_URL?.trim()
  if (configured) return configured
  return getNetwork() === 'mainnet' ? MAINNET_PUBLISHER_URL : TESTNET_PUBLISHER_URLS[0]!
}

function getAggregatorUrl(): string {
  const configured = process.env.WALRUS_AGGREGATOR_URL?.trim()
  if (configured) return configured
  return getNetwork() === 'mainnet' ? MAINNET_AGGREGATOR_URL : TESTNET_AGGREGATOR_URL
}

function parseRequiredNumber(raw: string, fieldName: string, csvRow: number): number {
  const trimmed = raw.trim()
  if (trimmed === '') {
    throw new Error(`Row ${csvRow}: ${fieldName} is empty`)
  }
  const value = Number(trimmed)
  if (!isFinite(value) || value < 0) {
    throw new Error(`Row ${csvRow}: ${fieldName} must be a non-negative number, got "${raw}"`)
  }
  return value
}

function parseRequiredPositiveNumber(raw: string, fieldName: string, csvRow: number): number {
  const value = parseRequiredNumber(raw, fieldName, csvRow)
  if (value <= 0) {
    throw new Error(`Row ${csvRow}: ${fieldName} must be greater than 0, got "${raw}"`)
  }
  return value
}

// ── CSV Parser ─────────────────────────────────────────────

function parseCSV(csvPath: string): SoulRow[] {
  const content = readFileSync(csvPath, 'utf8').trim()
  const lines = content.split('\n')
  if (lines.length < 2) {
    throw new Error('template.csv must have a header row and at least one data row')
  }

  // Skip header
  return lines.slice(1).map((line, i) => {
    // Parse CSV with quoted fields containing commas
    const fields: string[] = []
    let current = ''
    let inQuotes = false

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    fields.push(current.trim())

    if (fields.length < 5) {
      throw new Error(`Row ${i + 2} has only ${fields.length} fields, expected 5`)
    }

    const tagsRaw = fields[2]!.split(',').map(t => t.trim()).filter(Boolean)

    const creatorRoyaltyPct = parseRequiredNumber(fields[3]!, 'creatorRoyaltyPct', i + 2)
    const priceUsdc = parseRequiredPositiveNumber(fields[4]!, 'priceUsdc', i + 2)

    return {
      index: i + 1,
      name: fields[0]!,
      description: fields[1]!,
      tags: tagsRaw,
      creatorRoyaltyPct,
      priceUsdc,
    }
  })
}

// ── Tag Normalization (inlined from web/lib/soulidity/tags) ──

const MAX_TAGS = 12
const MAX_TAG_LENGTH = 50

function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>()
  for (const tag of raw) {
    const trimmed = tag.trim()
    if (!trimmed) continue
    const key = trimmed.slice(0, MAX_TAG_LENGTH).toLowerCase()
    seen.add(key)
  }
  return [...seen].slice(0, MAX_TAGS)
}

// ── Walrus Upload ──────────────────────────────────────────

interface WalrusStoreResponse {
  newlyCreated?: { blobObject: { blobId: string; id: string } }
  alreadyCertified?: { blobId: string }
}

async function uploadToWalrus(
  buffer: Buffer,
  sendObjectTo?: string,
): Promise<{ blobId: string; blobObjectId: string | null }> {
  const publisherUrl = getWalrusPublisherUrl()
  const url = new URL(`${publisherUrl}/v1/blobs`)
  if (sendObjectTo) {
    url.searchParams.set('send_object_to', sendObjectTo)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WALRUS_UPLOAD_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(buffer),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500)
      throw new Error(`Walrus upload failed: ${res.status} ${text}`)
    }
    const data = (await res.json()) as WalrusStoreResponse
    const blobId = data.newlyCreated?.blobObject.blobId ?? data.alreadyCertified?.blobId
    if (!blobId) {
      throw new Error('Walrus response missing blobId')
    }
    return {
      blobId,
      blobObjectId: data.newlyCreated?.blobObject.id ?? null,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function encryptBuffer(buffer: Buffer): {
  ciphertext: Buffer
  dek: Buffer
  iv: Buffer
  contentHash: string
} {
  const dek = randomBytes(32)
  const iv = randomBytes(12)
  const contentHash = createHash('sha256').update(buffer).digest('hex')
  const cipher = createCipheriv('aes-256-gcm', dek, iv)
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final(), cipher.getAuthTag()])
  return { ciphertext, dek, iv, contentHash }
}

function sealDekEnvelopeLocal(params: {
  dek: Buffer
  iv: Buffer
  contentHash: string
  mimeType: string
  fileName: string
}): string {
  const secret = process.env.SOUL_UPLOAD_SECRET
  if (!secret || secret.length !== 64 || !/^[0-9a-fA-F]+$/.test(secret)) {
    throw new Error('SOUL_UPLOAD_SECRET must be a 64-character hex string (32 bytes)')
  }
  const secretBuf = Buffer.from(secret, 'hex')
  const payload = JSON.stringify({
    dek: params.dek.toString('base64'),
    iv: params.iv.toString('base64'),
    contentHash: params.contentHash,
    mimeType: params.mimeType,
    fileName: params.fileName,
  })
  const envelopeIv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretBuf, envelopeIv)
  const encrypted = Buffer.concat([cipher.update(Buffer.from(payload, 'utf8')), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([envelopeIv, authTag, encrypted]).toString('base64')
}

async function uploadEncrypted(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  sendObjectTo: string,
): Promise<UploadResult> {
  const { ciphertext, dek, iv, contentHash } = encryptBuffer(buffer)
  const walrus = await uploadToWalrus(ciphertext, sendObjectTo)
  const envelope = sealDekEnvelopeLocal({ dek, iv, contentHash, mimeType, fileName })
  return {
    blobId: walrus.blobId,
    blobObjectId: walrus.blobObjectId,
    contentHash,
    sealDekEnvelope: envelope,
  }
}

async function uploadPublicImage(
  buffer: Buffer,
  sendObjectTo: string,
): Promise<UploadResult> {
  const contentHash = createHash('sha256').update(buffer).digest('hex')
  const walrus = await uploadToWalrus(buffer, sendObjectTo)
  return {
    blobId: walrus.blobId,
    blobObjectId: walrus.blobObjectId,
    contentHash,
  }
}

// ── Skill Zip Builder ──────────────────────────────────────

function buildSkillZip(skillMdContent: Buffer): Buffer {
  const zipped = zipSync({ 'SKILL.md': new Uint8Array(skillMdContent) }, { level: 6 })
  return Buffer.from(zipped)
}

// ── Manifest I/O ───────────────────────────────────────────

function loadManifest(): Manifest | null {
  if (!existsSync(MANIFEST_PATH)) return null
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

function saveManifest(manifest: Manifest): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}

// ── TX Builders (inlined to avoid Next.js path alias issues) ──

function buildPublishSoulTx(
  deployment: SoulidityDeployment,
  params: {
    currentKioskId?: string | null
    currentKioskCapOnChainId?: string | null
    name: string
    description: string
    imageUrl: string
    protectedBlobObjectId: string
    foundingMemoryBlobObjectId?: string | null
    skillsBlobObjectId?: string | null
    initialSkillName?: string
    creatorRoyaltyBps: number
  },
): Transaction {
  const { packageId, marketConfigId, kioskRegistryId, soulTransferPolicyId } = deployment
  const kioskPackageId = process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID?.trim() || '0x2'
  const tx = new Transaction()

  const hasKiosk = params.currentKioskId && params.currentKioskCapOnChainId
  let buyerKiosk: ReturnType<Transaction['object']>
  let buyerKioskCap: ReturnType<Transaction['object']>
  let needsTransfer = false

  if (hasKiosk) {
    tx.moveCall({
      target: `${packageId}::market::ensure_personal_kiosk_registered`,
      arguments: [
        tx.object(marketConfigId),
        tx.object(kioskRegistryId),
        tx.object(params.currentKioskCapOnChainId!),
      ],
    })
    buyerKiosk = tx.object(params.currentKioskId!)
    buyerKioskCap = tx.object(params.currentKioskCapOnChainId!)
  } else {
    const [newKiosk, kioskOwnerCap] = tx.moveCall({
      target: '0x2::kiosk::new',
      arguments: [],
    })
    const [personalKioskCap] = tx.moveCall({
      target: `${kioskPackageId}::personal_kiosk::new`,
      arguments: [newKiosk, kioskOwnerCap],
    })
    tx.moveCall({
      target: `${packageId}::market::register_existing_personal_kiosk`,
      arguments: [
        tx.object(marketConfigId),
        tx.object(kioskRegistryId),
        personalKioskCap,
      ],
    })
    buyerKiosk = newKiosk
    buyerKioskCap = personalKioskCap
    needsTransfer = true
  }

  tx.moveCall({
    target: `${packageId}::market::mint_native_in_personal_kiosk`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(soulTransferPolicyId),
      buyerKiosk,
      buyerKioskCap,
      tx.pure.string(params.name),
      tx.pure.string(params.description),
      tx.pure.string(params.imageUrl),
      tx.pure.option('string', null), // metadataRef
      tx.object(params.protectedBlobObjectId),
      tx.object.option({
        type: WALRUS_BLOB_TYPE,
        value: params.foundingMemoryBlobObjectId ? tx.object(params.foundingMemoryBlobObjectId) : null,
      }),
      tx.object.option({
        type: WALRUS_BLOB_TYPE,
        value: params.skillsBlobObjectId ? tx.object(params.skillsBlobObjectId) : null,
      }),
      tx.pure.string(params.initialSkillName || 'default'),
      tx.pure.bool(false), // skillsVisibility = private
      tx.object.option({ type: WALRUS_BLOB_TYPE, value: null }), // assetBlob
      tx.pure.string('default'), // initialAssetName
      tx.pure.bool(false), // assetVisibility
      tx.pure.u8(0), // assetType = sprite
      tx.pure.u64(0), // contentAccessPriceAtomic
      tx.pure.u64(0), // contentAccessDefaultScopeMask
      tx.pure.u16(params.creatorRoyaltyBps),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })

  if (needsTransfer) {
    tx.moveCall({
      target: '0x2::transfer::public_share_object',
      typeArguments: ['0x2::kiosk::Kiosk'],
      arguments: [buyerKiosk],
    })
    tx.moveCall({
      target: `${kioskPackageId}::personal_kiosk::transfer_to_sender`,
      arguments: [buyerKioskCap],
    })
  }

  return tx
}

function buildListSoulTx(
  deployment: SoulidityDeployment,
  params: {
    currentKioskId: string
    currentKioskCapOnChainId: string
    stateObjectId: string
    soulObjectId: string
    priceAtomic: bigint
  },
): Transaction {
  if (params.priceAtomic <= 0n) {
    throw new Error('priceAtomic must be positive')
  }

  const { packageId, marketConfigId, kioskRegistryId } = deployment
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::market::ensure_personal_kiosk_registered`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.currentKioskCapOnChainId),
    ],
  })

  tx.moveCall({
    target: `${packageId}::market::list_soul_fixed_price`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.object(params.stateObjectId),
      tx.pure.id(params.soulObjectId),
      tx.pure.u64(params.priceAtomic),
    ],
  })

  return tx
}

// ── Kiosk Resolution ───────────────────────────────────────

interface PersonalKiosk {
  kioskId: string
  kioskCapId: string
}

async function resolvePersonalKiosk(
  suiClient: SuiClient,
  ownerAddress: string,
): Promise<PersonalKiosk | null> {
  const kioskPackageId = process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID?.trim() || '0x2'
  const personalKioskCapType = `${kioskPackageId}::personal_kiosk::PersonalKioskCap`

  const response = await suiClient.getOwnedObjects({
    owner: ownerAddress,
    filter: { StructType: personalKioskCapType },
    options: { showContent: true },
  })

  if (!response.data.length) return null

  const capObj = response.data[0]
  const fields = (capObj.data?.content as { fields?: Record<string, unknown> })?.fields
  if (!fields) return null

  return {
    kioskId: String(fields.for ?? fields.kiosk),
    kioskCapId: capObj.data!.objectId!,
  }
}

// ── API Helpers ────────────────────────────────────────────

async function apiPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { token, baseUrl } = getApiConfig()
  const url = `${baseUrl}${path}`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  const json = await res.json()
  if (!res.ok) {
    throw new Error(`API ${path} returned ${res.status}: ${JSON.stringify(json)}`)
  }
  return json as Record<string, unknown>
}

// ── Phase Executors ────────────────────────────────────────

async function phaseUpload(
  entry: SoulManifestEntry,
  row: SoulRow,
  signerAddress: string,
): Promise<void> {
  const soulDir = join(SOULS_DIR, String(row.index))
  const soulMdPath = join(soulDir, 'soul.md')
  const memoryMdPath = join(soulDir, 'memory.md')
  const imagePngPath = join(soulDir, 'image.png')
  const skillsDir = join(soulDir, 'skills')

  // soul.md — encrypted
  log(entry.index, 'Uploading soul.md (encrypted)...')
  const soulBuffer = readFileSync(soulMdPath)
  entry.soulUpload = await uploadEncrypted(soulBuffer, 'soul.md', 'application/octet-stream', signerAddress)
  saveManifest(currentManifest!)

  // memory.md — encrypted
  if (existsSync(memoryMdPath)) {
    log(entry.index, 'Uploading memory.md (encrypted)...')
    const memoryBuffer = readFileSync(memoryMdPath)
    entry.memoryUpload = await uploadEncrypted(memoryBuffer, 'memory.md', 'application/octet-stream', signerAddress)
    saveManifest(currentManifest!)
  }

  // skills/*.md — zip as SKILL.md, encrypted
  if (existsSync(skillsDir)) {
    const skillFiles = readdirSync(skillsDir).filter(f => f.endsWith('.md'))
    if (skillFiles.length > 0) {
      const skillFile = skillFiles[0]!
      log(entry.index, `Zipping + uploading skill: ${skillFile} (encrypted)...`)
      const skillContent = readFileSync(join(skillsDir, skillFile))
      const zipBuffer = buildSkillZip(skillContent)
      entry.skillUpload = await uploadEncrypted(zipBuffer, 'skills.zip', 'application/zip', signerAddress)

      // Extract skill name from frontmatter
      const skillText = skillContent.toString('utf8')
      const nameMatch = skillText.match(/^---[\s\S]*?^name:\s*(.+?)$/m)
      entry.skillName = nameMatch?.[1]?.trim() ?? null
      saveManifest(currentManifest!)
    }
  }

  // image.png — public
  if (existsSync(imagePngPath)) {
    log(entry.index, 'Uploading image.png (public)...')
    const imageBuffer = readFileSync(imagePngPath)
    entry.imageUpload = await uploadPublicImage(imageBuffer, signerAddress)
    saveManifest(currentManifest!)
  }

  entry.phase = 'uploaded'
  saveManifest(currentManifest!)
}

async function phaseMint(
  entry: SoulManifestEntry,
  row: SoulRow,
  deployment: SoulidityDeployment,
  keypair: Ed25519Keypair,
  client: SuiClient,
): Promise<void> {
  const signerAddress = keypair.getPublicKey().toSuiAddress()
  const kiosk = await resolvePersonalKiosk(client, signerAddress)

  if (!entry.soulUpload?.blobObjectId) {
    throw new Error('soul upload missing blobObjectId — cannot mint')
  }

  const imageUrl = entry.imageUpload
    ? `${getAggregatorUrl()}/v1/blobs/${encodeURIComponent(entry.imageUpload.blobId)}`
    : '' // Will fail validation if truly empty

  log(entry.index, 'Building mint TX...')
  const tx = buildPublishSoulTx(deployment, {
    currentKioskId: kiosk?.kioskId,
    currentKioskCapOnChainId: kiosk?.kioskCapId,
    name: row.name,
    description: row.description,
    imageUrl,
    protectedBlobObjectId: entry.soulUpload.blobObjectId,
    foundingMemoryBlobObjectId: entry.memoryUpload?.blobObjectId ?? null,
    skillsBlobObjectId: entry.skillUpload?.blobObjectId ?? null,
    initialSkillName: entry.skillName ?? undefined,
    creatorRoyaltyBps: Math.round(row.creatorRoyaltyPct * 100),
  })

  tx.setSender(signerAddress)

  log(entry.index, 'Signing + executing mint TX...')
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  })

  if (result.effects?.status?.status !== 'success') {
    throw new Error(`Mint TX failed: ${JSON.stringify(result.effects?.status)}`)
  }

  entry.mintTxDigest = result.digest

  // Extract Soul object ID from events
  const packageId = deployment.packageId
  const mintEvent = result.events?.find((e: { type?: string }) =>
    e.type?.includes(`${packageId}::market::SoulMintedToKiosk`),
  )
  if (mintEvent?.parsedJson) {
    const json = mintEvent.parsedJson as Record<string, unknown>
    entry.soulOnChainId = String(json.soul_id ?? '')
    entry.stateOnChainId = String(json.state_id ?? '')
  }

  // Fallback: extract from object changes
  if (!entry.soulOnChainId) {
    const soulObjType = `${packageId}::soul::Soul`
    const soulChange = result.objectChanges?.find((c: Record<string, unknown>) =>
      c.objectType?.toString().includes(soulObjType),
    )
    if (soulChange) {
      entry.soulOnChainId = String((soulChange as Record<string, unknown>).objectId ?? '')
    }
  }

  if (!entry.soulOnChainId) {
    throw new Error('Could not extract Soul object ID from mint TX result')
  }

  entry.phase = 'minted'
  saveManifest(currentManifest!)
  log(entry.index, `Minted: soul=${entry.soulOnChainId} tx=${result.digest}`)
}

async function phaseSync(
  entry: SoulManifestEntry,
  row: SoulRow,
): Promise<void> {
  if (!entry.mintTxDigest || !entry.soulOnChainId) {
    throw new Error('Cannot sync without mint TX digest and Soul ID')
  }

  log(entry.index, 'Syncing publish to API...')

  const body: Record<string, unknown> = {
    txDigest: entry.mintTxDigest,
    tags: normalizeTags(row.tags),
    previewImages: [],
    sealSidecar: entry.soulUpload?.sealDekEnvelope ?? null,
    memorySealSidecar: entry.memoryUpload?.sealDekEnvelope ?? null,
    skillsSealSidecar: entry.skillUpload?.sealDekEnvelope ?? null,
  }

  const result = await apiPost('/api/souls/publish', body)
  entry.synced = true
  entry.phase = 'synced'
  saveManifest(currentManifest!)
  log(entry.index, `Synced: soulOnChainId=${result.soulOnChainId}`)
}

async function phaseList(
  entry: SoulManifestEntry,
  row: SoulRow,
  deployment: SoulidityDeployment,
  keypair: Ed25519Keypair,
  client: SuiClient,
): Promise<void> {
  const priceAtomic = BigInt(Math.round(row.priceUsdc * 10 ** USDC_DECIMALS))
  const signerAddress = keypair.getPublicKey().toSuiAddress()
  const kiosk = await resolvePersonalKiosk(client, signerAddress)

  if (!kiosk) {
    throw new Error('No personal kiosk found — mint should have created one')
  }
  if (!entry.soulOnChainId || !entry.stateOnChainId) {
    throw new Error('Missing Soul or State on-chain IDs for listing')
  }

  log(entry.index, `Building list TX (${row.priceUsdc} USDC = ${priceAtomic} atomic)...`)
  const tx = buildListSoulTx(deployment, {
    currentKioskId: kiosk.kioskId,
    currentKioskCapOnChainId: kiosk.kioskCapId,
    stateObjectId: entry.stateOnChainId,
    soulObjectId: entry.soulOnChainId,
    priceAtomic,
  })

  tx.setSender(signerAddress)

  log(entry.index, 'Signing + executing list TX...')
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showEvents: true },
  })

  if (result.effects?.status?.status !== 'success') {
    throw new Error(`List TX failed: ${JSON.stringify(result.effects?.status)}`)
  }

  entry.listTxDigest = result.digest
  entry.phase = 'listed'
  saveManifest(currentManifest!)
  log(entry.index, `Listed: tx=${result.digest}`)
}

async function phaseSyncList(
  entry: SoulManifestEntry,
): Promise<void> {
  if (!entry.listTxDigest || !entry.soulOnChainId) {
    // If no list TX and already done, skip (e.g. mint-only without listing)
    if (entry.phase === 'done') return
    throw new Error('Cannot sync-list without list TX digest')
  }

  log(entry.index, 'Syncing listing to API...')
  const result = await apiPost(`/api/souls/${entry.soulOnChainId}/list`, {
    txDigest: entry.listTxDigest,
  })

  entry.listingStatus = String(result.listingStatus ?? 'listed')
  entry.phase = 'done'
  saveManifest(currentManifest!)
  log(entry.index, `Sync-list done: status=${entry.listingStatus}`)
}

// ── Logging ────────────────────────────────────────────────

function log(index: number, msg: string) {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] [Soul #${index}] ${msg}`)
}

function logError(index: number, msg: string) {
  const ts = new Date().toISOString().slice(11, 19)
  console.error(`[${ts}] [Soul #${index}] ERROR: ${msg}`)
}

// ── Main ───────────────────────────────────────────────────

let currentManifest: Manifest | null = null

function parseArgs(argv: string[]) {
  let resume = false
  let dryRun = false
  let startIndex: number | null = null
  let onlyIndex: number | null = null

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--resume') resume = true
    if (arg === '--dry-run') dryRun = true
    if (arg === '--start' && argv[i + 1]) {
      startIndex = parseInt(argv[++i]!, 10)
    }
    if (arg === '--only' && argv[i + 1]) {
      onlyIndex = parseInt(argv[++i]!, 10)
    }
  }

  return { resume, dryRun, startIndex, onlyIndex }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const rows = parseCSV(TEMPLATE_CSV)
  const network = getNetwork()
  const deployment = getDeployment()
  const keypair = loadKeypairFromEnv('BATCH_SIGNER_SECRET_KEY')
  const signerAddress = keypair.getPublicKey().toSuiAddress()
  const client = getSuiClient()

  console.log(`\n=== Batch Soul Publisher ===`)
  console.log(`Network:  ${network}`)
  console.log(`Signer:   ${signerAddress}`)
  console.log(`Package:  ${deployment.packageId}`)
  console.log(`Souls:    ${rows.length}`)
  console.log(`Resume:   ${args.resume}`)
  console.log(`Dry-run:  ${args.dryRun}`)
  console.log('')

  // Load or create manifest
  let manifest: Manifest
  if (args.resume && existsSync(MANIFEST_PATH)) {
    manifest = loadManifest()!
    console.log(`Loaded manifest with ${manifest.entries.length} entries`)
  } else {
    manifest = {
      createdAt: new Date().toISOString(),
      signerAddress,
      network,
      entries: rows.map(row => ({
        index: row.index,
        name: row.name,
        phase: 'pending' as Phase,
      })),
    }
  }
  currentManifest = manifest
  saveManifest(manifest)

  // Determine which entries to process
  let entriesToProcess = manifest.entries
  if (args.onlyIndex) {
    entriesToProcess = entriesToProcess.filter(e => e.index === args.onlyIndex)
  } else if (args.startIndex) {
    entriesToProcess = entriesToProcess.filter(e => e.index >= args.startIndex!)
  }

  if (args.dryRun) {
    console.log('DRY RUN — showing planned actions:\n')
    for (const entry of entriesToProcess) {
      const row = rows.find(r => r.index === entry.index)!
      const soulDir = join(SOULS_DIR, String(entry.index))
      const hasImage = existsSync(join(soulDir, 'image.png'))
      const hasMem = existsSync(join(soulDir, 'memory.md'))
      const skillsDir = join(soulDir, 'skills')
      const hasSkill = existsSync(skillsDir) && readdirSync(skillsDir).some(f => f.endsWith('.md'))

      console.log(`  #${entry.index} "${row.name}"`)
      console.log(`    Phase:    ${entry.phase}`)
      console.log(`    Tags:     ${normalizeTags(row.tags).join(', ')}`)
      console.log(`    Royalty:  ${row.creatorRoyaltyPct}% (${Math.round(row.creatorRoyaltyPct * 100)} bps)`)
      console.log(`    Price:    ${row.priceUsdc} USDC`)
      console.log(`    Files:    soul.md${hasMem ? ' memory.md' : ''}${hasSkill ? ' skill.zip' : ''}${hasImage ? ' image.png' : ''}`)
      console.log('')
    }
    return
  }

  // Process each soul sequentially
  let successCount = 0
  let errorCount = 0

  for (const entry of entriesToProcess) {
    const row = rows.find(r => r.index === entry.index)
    if (!row) {
      logError(entry.index, `No CSV row found for index ${entry.index}`)
      continue
    }

    if (entry.phase === 'done') {
      log(entry.index, `Already done — skipping`)
      successCount++
      continue
    }

    try {
      // Execute remaining phases
      if (entry.phase === 'pending') {
        await phaseUpload(entry, row, signerAddress)
      }
      if (entry.phase === 'uploaded') {
        await phaseMint(entry, row, deployment, keypair, client)
      }
      if (entry.phase === 'minted') {
        await phaseSync(entry, row)
      }
      if (entry.phase === 'synced') {
        await phaseList(entry, row, deployment, keypair, client)
      }
      if (entry.phase === 'listed') {
        await phaseSyncList(entry)
      }

      successCount++
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logError(entry.index, errMsg)
      entry.error = errMsg
      saveManifest(currentManifest!)
      errorCount++
      // Continue to next soul instead of aborting
    }
  }

  console.log(`\n=== Summary ===`)
  console.log(`  Success: ${successCount}`)
  console.log(`  Errors:  ${errorCount}`)
  console.log(`  Total:   ${entriesToProcess.length}`)
  console.log(`  Manifest: ${MANIFEST_PATH}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
