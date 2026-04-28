/**
 * E2E sprite lifecycle helper.
 *
 * Exercises the full append / activate / delete / clear loop for persona
 * sprites on an existing Soul. Uses two real asset sets bundled under
 * `desktop/data/assets/<name>/` as the two sprite versions, uploads the
 * PNGs to Walrus, signs the Move TXs owner-side, and mirrors the same DB
 * projections the HTTP routes would write (via the shared mirror helpers).
 *
 * Both public (direct Walrus) and private (Seal-envelope) sprite paths are
 * supported. Private mode: the script AES-GCM encrypts the sprite sheet
 * locally with a random DEK, uploads the ciphertext to Walrus, appends the
 * version on chain, then builds the Seal envelope sidecar (with a document
 * id bound to `assetsObjectId|assetName|versionIndex`) and mirrors it into
 * `SoulAssetVersionRecord.sealSidecar`, matching what `/api/souls/[id]/assets`
 * produces via `buildSyncSealSidecars`.
 *
 * Usage (run from the `web/` directory so the `@/*` alias resolves):
 *   cd web
 *   OWNER_PRIVATE_KEY="suiprivkey1..." \
 *   SOUL_ON_CHAIN_ID="0x..." \
 *   NEXT_PUBLIC_SUI_NETWORK="testnet" \
 *   DATABASE_URL="postgresql://..." \
 *   npx tsx scripts/e2e-sprite-lifecycle.ts <subcommand>
 *
 * Subcommands:
 *   append <wusaqi|walrus> [public|private]
 *                                   Upload sprite.png + append on-chain version
 *   activate <versionIndex> [wusaqi|walrus] [public|owner_only|allowlist]
 *                                   Upsert sprite metadata blobs + set_active_sprite
 *   delete <versionIndex>           delete_version_as_owner
 *   clear                           clear_active_sprite
 *   inspect                         Print current on-chain + DB sprite state
 *   run-all                         Happy path covering both public and private:
 *                                   append wusaqi public → activate public →
 *                                   append walrus private → activate owner_only →
 *                                   delete v0 → clear
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'

import { SealClient, type KeyServerConfig } from '@mysten/seal'

import { prisma } from '@/lib/prisma'
import { uploadEncrypted, uploadPublic } from '@/lib/services/walrus'
import { createAssetVersionSealEnvelopeSidecar } from '@/lib/services/seal-crypto'
import { buildAppendAssetVersionTx, buildDeleteAssetVersionTx } from '@/lib/soulidity/tx/assets'
import { buildClearActiveSpriteTx } from '@/lib/soulidity/tx/metadata'
import {
  extractAssetVersionAppendedEvent,
  extractAssetVersionDeletedEvent,
  extractSoulMetadataMutationEvent,
} from '@/lib/soulidity/events'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { resolveWalrusBlobId } from '@/lib/soulidity/queries'
import { syncSoulProjectionFromChain } from '@/lib/soulidity/mirror/sync-helpers'
import {
  markAssetVersionDeleted,
  upsertAssetVersionProjection,
} from '@/lib/soulidity/mirror/upsert-asset'

const SUI_NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet') as 'mainnet' | 'testnet' | 'devnet'
const SPRITE_ASSET_NAME = 'persona-sprite'
const SPRITE_CONFIG_KEY = 'sprite.config.v1'
const SPRITE_MOOD_MAP_KEY = 'sprite.mood_map.v1'
const DEFAULT_ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../desktop/data/assets')

const suiClient = new SuiJsonRpcClient({
  url: getJsonRpcFullnodeUrl(SUI_NETWORK),
  network: SUI_NETWORK,
})

// ------------------------------------------------------------------ helpers

type AssetKey = 'wusaqi' | 'walrus'

interface AssetSet {
  key: AssetKey
  spritePath: string
  manifestPath: string
  manifest: { frameWidth: number; frameHeight: number; columns: number; rows: number; name: string }
}

function loadAssetSet(key: AssetKey): AssetSet {
  const baseDir = process.env.DESKTOP_ASSETS_DIR?.trim() || DEFAULT_ASSETS_DIR
  const spritePath = join(baseDir, key, 'sprite.png')
  const manifestPath = join(baseDir, key, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AssetSet['manifest']
  return { key, spritePath, manifestPath, manifest }
}

/**
 * Build the `SpriteSheetAssetBase` (public-asset shape) from a bundled desktop
 * manifest. Maps the 7-row × 8-col layout to the canonical animation names
 * used by the default-persona starter sprite.
 */
function buildSpriteConfig(asset: AssetSet) {
  const cols = asset.manifest.columns
  const row = (r: number) => Array.from({ length: cols }, (_, i) => r * cols + i)
  return {
    type: 'sprite-sheet' as const,
    frameWidth: asset.manifest.frameWidth,
    frameHeight: asset.manifest.frameHeight,
    columns: cols,
    animations: {
      idle:              { frames: row(0), fps: 4,  loop: true },
      thinking:          { frames: row(1), fps: 6,  loop: true },
      completed:         { frames: row(2), fps: 4,  loop: false },
      working:           { frames: row(3), fps: 8,  loop: true },
      'needs-attention': { frames: row(4), fps: 4,  loop: true },
      error:             { frames: row(5), fps: 2,  loop: true },
      dragging:          { frames: row(6), fps: 10, loop: true },
    },
  }
}

function buildMoodMap() {
  return {
    idle: 'idle',
    happy: 'completed',
    love: 'idle',
    excited: 'thinking',
    celebrate: 'completed',
    sleepy: 'idle',
    snoring: 'error',
    working: 'working',
    angry: 'error',
    surprised: 'needs-attention',
    shy: 'idle',
    dragging: 'dragging',
  }
}

function keypairFromEnv() {
  const privateKey = process.env.OWNER_PRIVATE_KEY?.trim()
  const mnemonic = process.env.OWNER_MNEMONIC?.trim()
  if (privateKey) {
    return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(privateKey).secretKey)
  }
  if (mnemonic) {
    return Ed25519Keypair.deriveKeypair(mnemonic)
  }
  throw new Error('OWNER_PRIVATE_KEY or OWNER_MNEMONIC is required')
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function loadSoulContext() {
  const soulOnChainId = requireEnv('SOUL_ON_CHAIN_ID')
  const soul = await prisma.soulAsset.findUnique({
    where: { onChainId: soulOnChainId },
    select: {
      onChainId: true,
      stateOnChainId: true,
      memoryOnChainId: true,
      metadataOnChainId: true,
      assetsOnChainId: true,
      listingObjectOnChainId: true,
      listedPriceAtomic: true,
      listingStatus: true,
      creatorMemberId: true,
      currentOwnerMemberId: true,
      tags: true,
      previewImages: true,
      readme: true,
      sealSidecar: true,
      activeSpriteAssetName: true,
      activeSpriteVersionIndex: true,
      activeSpriteDownloadPolicy: true,
      spriteConfigJson: true,
      spriteMoodMapJson: true,
    },
  })
  if (!soul) throw new Error(`Soul ${soulOnChainId} not found in DB`)
  if (!soul.assetsOnChainId) throw new Error(`Soul ${soulOnChainId} has no assetsOnChainId`)
  if (!soul.metadataOnChainId) throw new Error(`Soul ${soulOnChainId} has no metadataOnChainId`)
  return soul
}

type Soul = Awaited<ReturnType<typeof loadSoulContext>>

async function executeTx(tx: Transaction, sender: string, keypair: Ed25519Keypair) {
  tx.setSender(sender)
  const rawBytes = await tx.build({ client: suiClient })
  const { signature } = await keypair.signTransaction(rawBytes)
  const result = await suiClient.executeTransactionBlock({
    transactionBlock: Buffer.from(rawBytes).toString('base64'),
    signature,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  })
  await suiClient.waitForTransaction({ digest: result.digest }).catch(() => undefined)
  if (result.effects?.status?.status !== 'success') {
    throw new Error(`TX failed: ${JSON.stringify(result.effects?.status)}`)
  }
  return result
}

type SpriteVisibility = 'public' | 'private'
type SpriteDownloadPolicy = 'public' | 'owner_only' | 'allowlist'

const DEFAULT_TESTNET_SEAL_KEY_SERVER: KeyServerConfig = {
  objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  weight: 1,
}

function parseSealServerConfigs(raw: string | undefined): KeyServerConfig[] | null {
  if (!raw?.trim()) return null
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) return []
  const out: KeyServerConfig[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const cand = entry as Record<string, unknown>
    if (typeof cand.objectId !== 'string' || !cand.objectId.trim()) continue
    const config: KeyServerConfig = {
      objectId: cand.objectId.trim(),
      weight: typeof cand.weight === 'number' && cand.weight > 0 ? cand.weight : 1,
    }
    if (typeof cand.apiKeyName === 'string' && cand.apiKeyName.trim()) config.apiKeyName = cand.apiKeyName.trim()
    if (typeof cand.apiKey === 'string' && cand.apiKey.trim()) config.apiKey = cand.apiKey.trim()
    if (typeof cand.aggregatorUrl === 'string' && cand.aggregatorUrl.trim()) config.aggregatorUrl = cand.aggregatorUrl.trim()
    out.push(config)
  }
  return out
}

/**
 * Build a SealClient in a Node/tsx-safe way. Mirrors `createSealClient()` from
 * `lib/services/seal.ts` without importing it, since that module has a
 * `'server-only'` guard that only resolves inside the Next.js bundler.
 */
function buildSealClient() {
  const publicConfigs =
    parseSealServerConfigs(process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS)
    ?? (SUI_NETWORK === 'testnet' ? [DEFAULT_TESTNET_SEAL_KEY_SERVER] : [])
  const credentialedOverrides = parseSealServerConfigs(process.env.SEAL_SERVER_CONFIGS) ?? []
  const merged = new Map(publicConfigs.map((config) => [config.objectId, { ...config }]))
  for (const override of credentialedOverrides) {
    merged.set(override.objectId, { ...(merged.get(override.objectId) ?? {}), ...override })
  }
  const serverConfigs = Array.from(merged.values())
  if (serverConfigs.length === 0) {
    throw new Error('Seal key server config is not available (set NEXT_PUBLIC_SEAL_SERVER_CONFIGS for non-testnet networks).')
  }
  const thresholdEnv = Number.parseInt(process.env.NEXT_PUBLIC_SEAL_THRESHOLD ?? '', 10)
  const threshold = Number.isFinite(thresholdEnv) && thresholdEnv > 0
    ? Math.min(thresholdEnv, serverConfigs.length)
    : Math.min(2, serverConfigs.length)
  const verifyKeyServers = process.env.NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS !== 'false'
  const sealClient = new SealClient({
    suiClient: suiClient as never,
    serverConfigs,
    verifyKeyServers,
  })
  return { sealClient, threshold }
}

function downloadPolicyToU8(policy: SpriteDownloadPolicy): number {
  switch (policy) {
    case 'public': return 0
    case 'owner_only': return 1
    case 'allowlist': return 2
  }
}

function toCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  // Web Crypto types (TS lib.dom) require ArrayBuffer-backed views, not the
  // generic ArrayBufferLike. Copy into a fresh ArrayBuffer when the source is
  // not already ArrayBuffer (e.g. readFileSync returns a Node Buffer which may
  // be backed by a pooled SharedArrayBuffer on some versions).
  if (bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) as Uint8Array<ArrayBuffer>
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy as Uint8Array<ArrayBuffer>
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', toCryptoBytes(bytes))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function aesGcmEncrypt(plain: Uint8Array, dek: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    toCryptoBytes(dek),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toCryptoBytes(iv) },
    key,
    toCryptoBytes(plain),
  )
  return new Uint8Array(ciphertext)
}

async function resyncSoul(soul: Soul, packageId: string) {
  return syncSoulProjectionFromChain({
    packageId,
    soulObjectId: soul.onChainId,
    stateObjectId: soul.stateOnChainId,
    memoryObjectId: soul.memoryOnChainId,
    tags: soul.tags,
    previewImages: soul.previewImages,
    readme: soul.readme,
    sealSidecar: soul.sealSidecar as never,
    creatorMemberId: soul.creatorMemberId,
    currentOwnerMemberId: soul.currentOwnerMemberId,
    listingObjectOnChainId: soul.listingObjectOnChainId,
    listedPriceAtomic: soul.listedPriceAtomic ? BigInt(soul.listedPriceAtomic.toString()) : null,
    listingStatus: soul.listingStatus as 'held' | 'listed' | 'floor-violation',
  })
}

// ------------------------------------------------------------------ commands

async function cmdAppend(assetKey: AssetKey, visibility: SpriteVisibility) {
  const asset = loadAssetSet(assetKey)
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const soul = await loadSoulContext()
  const keypair = keypairFromEnv()
  const owner = normalizeSuiAddress(keypair.toSuiAddress())

  const plain = new Uint8Array(readFileSync(asset.spritePath))

  // Pre-compute plaintext hash / DEK / IV before upload so the post-TX sidecar
  // can bind to the same ciphertext we hand to Walrus. These values are only
  // needed when visibility === 'private'.
  const dek = globalThis.crypto.getRandomValues(new Uint8Array(32))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const contentHash = await sha256Hex(plain)
  const payload = visibility === 'private' ? await aesGcmEncrypt(plain, dek, iv) : plain

  console.log(`[append:${assetKey}:${visibility}] uploading ${asset.spritePath} (${payload.byteLength} bytes${visibility === 'private' ? ' ciphertext' : ''}) to Walrus`)
  const uploader = visibility === 'private' ? uploadEncrypted : uploadPublic
  const stored = await uploader(Buffer.from(payload), { sendObjectTo: owner })
  if (!stored.blobObjectId) {
    throw new Error('Walrus upload did not return a blobObjectId (blob already certified without newlyCreated). Re-run with a unique payload or use an exclusive blob.')
  }
  console.log(`[append:${assetKey}:${visibility}] walrus blob: ${stored.blobId} (object=${stored.blobObjectId})`)

  const tx = buildAppendAssetVersionTx({
    stateObjectId: soul.stateOnChainId,
    assetsObjectId: soul.assetsOnChainId!,
    assetName: SPRITE_ASSET_NAME,
    visibility,
    assetType: 'sprite',
    blobObjectId: stored.blobObjectId,
  })

  const result = await executeTx(tx, owner, keypair)
  const appended = extractAssetVersionAppendedEvent(result, packageId)
  console.log(`[append:${assetKey}:${visibility}] on-chain versionIndex=${appended.versionIndex}`)

  let sealSidecarJson: unknown = null
  if (visibility === 'private') {
    const { sealClient, threshold } = buildSealClient()
    sealSidecarJson = await createAssetVersionSealEnvelopeSidecar({
      sealClient,
      packageId,
      assetsObjectId: appended.assetsId,
      assetName: appended.assetName,
      versionIndex: appended.versionIndex,
      threshold,
      dek,
      iv,
      contentHash,
      mimeType: 'image/png',
      fileName: `${assetKey}-sprite.png`,
    })
  }

  const blobId = await resolveWalrusBlobId(appended.blobObjectId)
  await upsertAssetVersionProjection({
    version: {
      soulId: appended.soulId,
      assetsId: appended.assetsId,
      assetName: appended.assetName,
      versionIndex: appended.versionIndex,
      visibility: appended.visibility,
      assetType: appended.assetType,
      blobObjectId: appended.blobObjectId,
      blobId,
      createdAtMs: appended.createdAtMs,
    },
    soulOnChainId: soul.onChainId,
    assetsOnChainId: appended.assetsId,
    sealSidecar: sealSidecarJson as object | null,
  })
  await resyncSoul(soul, packageId)

  console.log(JSON.stringify({
    action: 'append',
    assetKey,
    digest: result.digest,
    versionIndex: appended.versionIndex,
    blobObjectId: appended.blobObjectId,
    blobId,
    visibility: appended.visibility,
    sealSidecar: sealSidecarJson ? 'mirrored' : null,
  }, null, 2))
}

async function cmdActivate(versionIndex: number, assetKey: AssetKey, policy: SpriteDownloadPolicy) {
  const asset = loadAssetSet(assetKey)
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const soul = await loadSoulContext()
  const keypair = keypairFromEnv()
  const owner = normalizeSuiAddress(keypair.toSuiAddress())

  const spriteConfig = buildSpriteConfig(asset)
  const moodMap = buildMoodMap()

  // Single PTB: upsert metadata blobs + set_active_sprite.
  const tx = new Transaction()

  // Reuse the builders' move call structure by copying their targets directly,
  // since we need one combined PTB (not three separate TXs).
  tx.moveCall({
    target: `${packageId}::metadata::upsert_metadata_blob`,
    arguments: [
      tx.object(soul.metadataOnChainId!),
      tx.object(soul.stateOnChainId),
      tx.pure.string(SPRITE_CONFIG_KEY),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(JSON.stringify(spriteConfig)))),
    ],
  })
  tx.moveCall({
    target: `${packageId}::metadata::upsert_metadata_blob`,
    arguments: [
      tx.object(soul.metadataOnChainId!),
      tx.object(soul.stateOnChainId),
      tx.pure.string(SPRITE_MOOD_MAP_KEY),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(JSON.stringify(moodMap)))),
    ],
  })
  tx.moveCall({
    target: `${packageId}::market::set_active_sprite`,
    arguments: [
      tx.object(soul.metadataOnChainId!),
      tx.object(soul.stateOnChainId),
      tx.object(soul.assetsOnChainId!),
      tx.pure.string(SPRITE_ASSET_NAME),
      tx.pure.u64(versionIndex),
      tx.pure.u8(downloadPolicyToU8(policy)),
    ],
  })

  const result = await executeTx(tx, owner, keypair)
  // extractSoulMetadataMutationEvent asserts the event exists and belongs to this soul.
  const mutation = extractSoulMetadataMutationEvent(result, packageId)
  if (mutation.soulId !== soul.onChainId) {
    throw new Error(`Metadata mutation reported foreign soul ${mutation.soulId}`)
  }

  await resyncSoul(soul, packageId)

  const refreshed = await prisma.soulAsset.findUnique({
    where: { onChainId: soul.onChainId },
    select: {
      activeSpriteAssetName: true,
      activeSpriteVersionIndex: true,
      activeSpriteDownloadPolicy: true,
      spriteConfigJson: true,
      spriteMoodMapJson: true,
    },
  })

  console.log(JSON.stringify({
    action: 'activate',
    assetKey,
    versionIndex,
    policy,
    digest: result.digest,
    mirrored: {
      activeSpriteAssetName: refreshed?.activeSpriteAssetName,
      activeSpriteVersionIndex: refreshed?.activeSpriteVersionIndex,
      activeSpriteDownloadPolicy: refreshed?.activeSpriteDownloadPolicy,
      spriteConfigJsonLen: refreshed?.spriteConfigJson?.length ?? 0,
      spriteMoodMapJsonLen: refreshed?.spriteMoodMapJson?.length ?? 0,
    },
  }, null, 2))
}

async function cmdDelete(versionIndex: number) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const soul = await loadSoulContext()
  const keypair = keypairFromEnv()
  const owner = normalizeSuiAddress(keypair.toSuiAddress())

  const tx = buildDeleteAssetVersionTx({
    stateObjectId: soul.stateOnChainId,
    metadataObjectId: soul.metadataOnChainId!,
    assetsObjectId: soul.assetsOnChainId!,
    assetName: SPRITE_ASSET_NAME,
    versionIndex,
  })

  const result = await executeTx(tx, owner, keypair)
  const deleted = extractAssetVersionDeletedEvent(result, packageId)
  await markAssetVersionDeleted({
    assetsOnChainId: deleted.assetsId,
    assetName: deleted.assetName,
    versionIndex: deleted.versionIndex,
  })
  await resyncSoul(soul, packageId)

  console.log(JSON.stringify({
    action: 'delete',
    versionIndex,
    digest: result.digest,
    soulId: deleted.soulId,
    assetsId: deleted.assetsId,
  }, null, 2))
}

async function cmdClear() {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const soul = await loadSoulContext()
  const keypair = keypairFromEnv()
  const owner = normalizeSuiAddress(keypair.toSuiAddress())

  const tx = buildClearActiveSpriteTx({
    metadataObjectId: soul.metadataOnChainId!,
    stateObjectId: soul.stateOnChainId,
  })

  const result = await executeTx(tx, owner, keypair)
  await resyncSoul(soul, packageId)

  const refreshed = await prisma.soulAsset.findUnique({
    where: { onChainId: soul.onChainId },
    select: {
      activeSpriteAssetName: true,
      activeSpriteVersionIndex: true,
      activeSpriteDownloadPolicy: true,
    },
  })
  console.log(JSON.stringify({
    action: 'clear',
    digest: result.digest,
    mirrored: refreshed,
  }, null, 2))
}

async function cmdInspect() {
  const soul = await loadSoulContext()
  const versions = await prisma.soulAssetVersionRecord.findMany({
    where: { soulOnChainId: soul.onChainId, assetName: SPRITE_ASSET_NAME },
    orderBy: { versionIndex: 'asc' },
    select: {
      versionIndex: true,
      visibility: true,
      assetType: true,
      deletedAt: true,
      blobId: true,
      blobObjectId: true,
      createdAtMs: true,
    },
  })
  console.log(JSON.stringify({
    action: 'inspect',
    soulOnChainId: soul.onChainId,
    active: {
      name: soul.activeSpriteAssetName,
      versionIndex: soul.activeSpriteVersionIndex,
      policy: soul.activeSpriteDownloadPolicy,
      configLen: soul.spriteConfigJson?.length ?? 0,
      moodMapLen: soul.spriteMoodMapJson?.length ?? 0,
    },
    versions: versions.map((v) => ({
      ...v,
      createdAtMs: Number(v.createdAtMs),
      deletedAt: v.deletedAt?.toISOString() ?? null,
    })),
  }, null, 2))
}

async function cmdRunAll() {
  const soul = await loadSoulContext()
  // Highest existing on-chain version index (+1) == next index. Use aggregate
  // rather than live count so soft-deleted rows still consume their slot.
  const latest = await prisma.soulAssetVersionRecord.findFirst({
    where: { soulOnChainId: soul.onChainId, assetName: SPRITE_ASSET_NAME },
    orderBy: { versionIndex: 'desc' },
    select: { versionIndex: true },
  })
  const baseIndex = latest ? latest.versionIndex + 1 : 0

  console.log(`[run-all] starting from versionIndex=${baseIndex}`)
  await cmdAppend('wusaqi', 'public')
  await cmdActivate(baseIndex, 'wusaqi', 'public')
  await cmdAppend('walrus', 'private')
  await cmdActivate(baseIndex + 1, 'walrus', 'owner_only')
  await cmdDelete(baseIndex)
  await cmdClear()
  await cmdInspect()
}

// ------------------------------------------------------------------ entry

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2)
  switch (subcommand) {
    case 'append': {
      const key = rest[0]
      const visibility = (rest[1] ?? 'public') as SpriteVisibility
      if (key !== 'wusaqi' && key !== 'walrus') {
        throw new Error('Usage: append <wusaqi|walrus> [public|private]')
      }
      if (visibility !== 'public' && visibility !== 'private') {
        throw new Error('visibility must be public or private')
      }
      return cmdAppend(key, visibility)
    }
    case 'activate': {
      const versionIndex = Number(rest[0])
      const key = (rest[1] ?? 'wusaqi') as AssetKey
      const policy = (rest[2] ?? 'public') as SpriteDownloadPolicy
      if (!Number.isSafeInteger(versionIndex) || versionIndex < 0) {
        throw new Error('Usage: activate <versionIndex> [wusaqi|walrus] [public|owner_only|allowlist]')
      }
      if (key !== 'wusaqi' && key !== 'walrus') {
        throw new Error('asset key must be wusaqi or walrus')
      }
      if (policy !== 'public' && policy !== 'owner_only' && policy !== 'allowlist') {
        throw new Error('policy must be public, owner_only, or allowlist')
      }
      return cmdActivate(versionIndex, key, policy)
    }
    case 'delete': {
      const versionIndex = Number(rest[0])
      if (!Number.isSafeInteger(versionIndex) || versionIndex < 0) {
        throw new Error('Usage: delete <versionIndex>')
      }
      return cmdDelete(versionIndex)
    }
    case 'clear':
      return cmdClear()
    case 'inspect':
      return cmdInspect()
    case 'run-all':
      return cmdRunAll()
    default:
      throw new Error('Usage: e2e-sprite-lifecycle.ts append|activate|delete|clear|inspect|run-all')
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main()
    .then(() => prisma.$disconnect().catch(() => undefined))
    .catch(async (error) => {
      console.error('Fatal:', error instanceof Error ? error.stack || error.message : error)
      await prisma.$disconnect().catch(() => undefined)
      process.exit(1)
    })
}
