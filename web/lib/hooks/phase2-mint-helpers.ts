/**
 * Phase 2 mint helpers shared by the four mint hooks
 * (`use-publish`, `use-import`, `use-wrap-publish`, `use-collection-publish`).
 *
 * Phase 2 Move + SDK accept a single `vector<InitialContentEntry>` plus
 * optional `vector<StateConfigEntry>` at mint time; per-slot Seal sidecars
 * are derived per emitted `ContentVersionAppended` event by pairing the
 * pending Seal material with the on-chain `(kind, name, versionIndex)`
 * triple via the canonical content-document id layout.
 */
'use client'

import type { SealClient } from '@mysten/seal'
import {
  CANONICAL_MEMORY_NAME,
  CANONICAL_SOUL_DOC_NAME,
  KIND_AUDIO,
  KIND_MEMORY,
  KIND_SKILL,
  KIND_SOUL_DOC,
  KIND_SPRITE,
  READ_GRANT,
  READ_OWNER,
  READ_PUBLIC,
} from '@soulidity/sdk'
import type { InitialContentEntryInput, StateConfigEntryInput } from '@soulidity/sdk'
import type { SealEnvelopeSidecar } from '@soulidity/sdk'
import { generateContentDocumentIdBytes } from '@soulidity/sdk'
import {
  base64ToBytes,
  bytesToBase64,
  createBrowserSealClient,
  type PendingSealMaterial,
} from '@/lib/upload/client-seal'
import type { SoulDownloadPolicy } from '@soulidity/sdk'

const DEK_BYTES = 32
const IV_BYTES = 12

/** A single content-sidecar entry shipped in the mirror-route request body. */
export interface ContentSidecarRequestEntry {
  kind: number
  name: string
  versionIndex: number
  sidecar: SealEnvelopeSidecar | null
}

/** Per-slot pending Seal material keyed by `(kind, name)`. The version index
 *  is unknown at upload time — every initial content slot is version 0, but
 *  we let the caller specify the kind/name pair so the post-TX pairing
 *  picks the right material per emitted event. */
export interface PendingMintSlot {
  kind: number
  name: string
  /** Pending Seal material from the upload pipeline. `null` for plaintext slots. */
  material: PendingSealMaterial | null
}

export interface PersonaSpriteOption {
  blobObjectId: string
  /** Display name written into `ContentSlot.name`. */
  assetName?: string | null
  visibility?: 'public' | 'private' | null
  spriteConfigJson?: string | null
  spriteMoodMapJson?: string | null
  /** Pending Seal material when uploaded as encrypted; null when public. */
  material?: PendingSealMaterial | null
}

export interface BuildPhase2MintInputsArgs {
  protectedBlobObjectId: string
  foundingMemoryBlobObjectId: string
  /** Optional initial skill (private). */
  skillsBlobObjectId?: string | null
  initialSkillName?: string | null
  initialSkillVisibility?: 'public' | 'private' | null
  /** Optional initial sprite (active-bound). */
  initialSprite?: PersonaSpriteOption | null
}

export interface BuildPhase2MintInputsResult {
  initialContent: InitialContentEntryInput[]
  initialStateConfig: StateConfigEntryInput[]
}

/**
 * Build the Phase 2 `(initialContent, initialStateConfig)` PTB args from the
 * legacy hook input (single-blob slots + optional sprite). Order is preserved
 * in the resulting `ContentVersionAppended` events: SOUL_DOC v0 first, then
 * MEMORY v0, then optional SKILL / SPRITE in declared order.
 */
export function buildPhase2InitialContent(args: BuildPhase2MintInputsArgs): BuildPhase2MintInputsResult {
  const initialContent: InitialContentEntryInput[] = [
    {
      kind: KIND_SOUL_DOC,
      name: CANONICAL_SOUL_DOC_NAME,
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: 'owner_only',
      setActive: false,
      blobObjectId: args.protectedBlobObjectId,
    },
    {
      kind: KIND_MEMORY,
      name: CANONICAL_MEMORY_NAME,
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: 'owner_only',
      setActive: false,
      blobObjectId: args.foundingMemoryBlobObjectId,
    },
  ]

  if (args.skillsBlobObjectId) {
    initialContent.push({
      kind: KIND_SKILL,
      name: args.initialSkillName ?? 'default',
      slotReadModeMask: READ_OWNER | READ_GRANT,
      downloadPolicy: 'owner_only',
      setActive: false,
      blobObjectId: args.skillsBlobObjectId,
    })
  }

  const initialStateConfig: StateConfigEntryInput[] = []
  if (args.initialSprite) {
    const visibility = args.initialSprite.visibility ?? 'private'
    const slotReadModeMask = visibility === 'public'
      ? (READ_OWNER | READ_GRANT | READ_PUBLIC)
      : (READ_OWNER | READ_GRANT)
    const downloadPolicy: SoulDownloadPolicy = visibility === 'public' ? 'public' : 'owner_only'
    initialContent.push({
      kind: KIND_SPRITE,
      name: args.initialSprite.assetName ?? 'persona-sprite',
      slotReadModeMask,
      downloadPolicy,
      setActive: true,
      blobObjectId: args.initialSprite.blobObjectId,
    })
    if (args.initialSprite.spriteConfigJson) {
      initialStateConfig.push({
        key: 'sprite_config_json',
        valueUtf8: args.initialSprite.spriteConfigJson,
      })
    }
    if (args.initialSprite.spriteMoodMapJson) {
      initialStateConfig.push({
        key: 'sprite_mood_map_json',
        valueUtf8: args.initialSprite.spriteMoodMapJson,
      })
    }
  }

  return { initialContent, initialStateConfig }
}

type SealEncryptCapableClient = Pick<SealClient, 'encrypt'>

/**
 * Build a content-version Seal sidecar (Phase 2 layout) from raw pending
 * material + the on-chain content-version triple. The document id is
 * derived from `(contentObjectId, kind, name, versionIndex)` plus a
 * cryptographic nonce — matching the Move-side
 * `assert_matching_document_id` check.
 */
async function createContentVersionSealSidecar(args: {
  sealClient: SealEncryptCapableClient
  packageId: string
  threshold: number
  contentObjectId: string
  kind: number
  name: string
  versionIndex: number
  material: PendingSealMaterial
}): Promise<SealEnvelopeSidecar> {
  const dek = base64ToBytes(args.material.dek)
  const iv = base64ToBytes(args.material.iv)
  if (dek.length !== DEK_BYTES) throw new Error('Pending Seal material contains an invalid DEK')
  if (iv.length !== IV_BYTES) throw new Error('Pending Seal material contains an invalid IV')

  const documentIdBytes = generateContentDocumentIdBytes({
    contentObjectId: args.contentObjectId,
    kind: args.kind,
    name: args.name,
    versionIndex: args.versionIndex,
  })
  const documentIdHex = `0x${Array.from(documentIdBytes, (b) => b.toString(16).padStart(2, '0')).join('')}`

  // Seal envelope wraps the DEK with a content-hash binding to defeat
  // ciphertext-substitution attacks; mirror createSealEnvelopeSidecar in
  // seal-crypto.ts but with a Phase 2 document id.
  const keyMaterial = new Uint8Array(64)
  keyMaterial.set(dek, 0)
  // Append the contentHash as the 32-byte tail.
  const hashBytes = (() => {
    const hex = args.material.contentHash.startsWith('0x')
      ? args.material.contentHash.slice(2)
      : args.material.contentHash
    if (hex.length !== 64) throw new Error('contentHash must be 32 bytes hex')
    const out = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }
    return out
  })()
  keyMaterial.set(hashBytes, 32)

  try {
    const { encryptedObject } = await args.sealClient.encrypt({
      threshold: args.threshold,
      packageId: args.packageId,
      id: documentIdHex,
      data: keyMaterial,
    })
    return {
      version: 1,
      mode: 'seal-envelope',
      documentId: documentIdHex,
      encryptedDek: bytesToBase64(new Uint8Array(encryptedObject)),
      iv: bytesToBase64(iv),
      cipher: 'AES-GCM-256',
      mimeType: args.material.mimeType,
      fileName: args.material.fileName,
      contentHash: args.material.contentHash,
    }
  } finally {
    keyMaterial.fill(0)
    dek.fill(0)
  }
}

export interface BuildContentSidecarsForVersionsArgs {
  sealClient: SealEncryptCapableClient
  packageId: string
  threshold: number
  /** Phase 2 SoulContent root id from `SoulMintedToKiosk.content_id`. */
  contentObjectId: string
  /** Per-slot pending material keyed by `(kind, name)`. */
  pendingByKindName: ReadonlyArray<{
    kind: number
    name: string
    material: PendingSealMaterial | null
  }>
  /** Emitted `ContentVersionAppended` events for this soul, in emission order. */
  versions: ReadonlyArray<{
    kind: number
    name: string
    versionIndex: number
    sealEncrypted: boolean
  }>
}

/**
 * Build a `contentSidecars[]` array for the API request body. Pure-public
 * slots return `sidecar: null`; sealed slots build a fresh content-version
 * sidecar via `createContentVersionSealSidecar`.
 */
export async function buildContentSidecarsForVersions(
  args: BuildContentSidecarsForVersionsArgs,
): Promise<ContentSidecarRequestEntry[]> {
  const out: ContentSidecarRequestEntry[] = []
  for (const version of args.versions) {
    const pending = args.pendingByKindName.find(
      (entry) => entry.kind === version.kind && entry.name === version.name,
    )
    if (!version.sealEncrypted) {
      out.push({ kind: version.kind, name: version.name, versionIndex: version.versionIndex, sidecar: null })
      continue
    }
    if (!pending?.material) {
      // The slot is sealed but no material is available — skip; the API will
      // reject at sidecar gate. Caller gets a 422 from the route.
      out.push({ kind: version.kind, name: version.name, versionIndex: version.versionIndex, sidecar: null })
      continue
    }
    const sidecar = await createContentVersionSealSidecar({
      sealClient: args.sealClient,
      packageId: args.packageId,
      threshold: args.threshold,
      contentObjectId: args.contentObjectId,
      kind: version.kind,
      name: version.name,
      versionIndex: version.versionIndex,
      material: pending.material,
    })
    out.push({
      kind: version.kind,
      name: version.name,
      versionIndex: version.versionIndex,
      sidecar,
    })
  }
  return out
}

/**
 * Convenience: return a `(kind, name) -> material` list from the canonical
 * single-blob mint inputs. Mirrors the slot order produced by
 * `buildPhase2InitialContent`.
 */
export function buildPendingMintSlots(args: {
  soulMaterial: PendingSealMaterial | null
  memoryMaterial: PendingSealMaterial | null
  skillsMaterial: PendingSealMaterial | null
  skillsName?: string | null
  spriteMaterial?: PendingSealMaterial | null
  spriteName?: string | null
}): Array<{ kind: number; name: string; material: PendingSealMaterial | null }> {
  const out: Array<{ kind: number; name: string; material: PendingSealMaterial | null }> = [
    { kind: KIND_SOUL_DOC, name: CANONICAL_SOUL_DOC_NAME, material: args.soulMaterial },
    { kind: KIND_MEMORY, name: CANONICAL_MEMORY_NAME, material: args.memoryMaterial },
  ]
  if (args.skillsMaterial) {
    out.push({ kind: KIND_SKILL, name: args.skillsName ?? 'default', material: args.skillsMaterial })
  }
  if (args.spriteMaterial) {
    out.push({
      kind: KIND_SPRITE,
      name: args.spriteName ?? 'persona-sprite',
      material: args.spriteMaterial,
    })
  }
  return out
}

// Re-export commonly-used kind constants so hook callers can import them
// from a single phase-2 helper module.
export {
  KIND_SOUL_DOC,
  KIND_MEMORY,
  KIND_SKILL,
  KIND_SPRITE,
  KIND_AUDIO,
  CANONICAL_SOUL_DOC_NAME,
  CANONICAL_MEMORY_NAME,
}

/**
 * Convenience wrapper: build a content sidecars array directly from a
 * SuiClient + pending material list, picking up the configured Seal
 * runtime config under the hood.
 */
export async function buildContentSidecarsForVersionsWithSuiClient(args: Omit<
  BuildContentSidecarsForVersionsArgs,
  'sealClient' | 'threshold'
> & {
  suiClient: Parameters<typeof createBrowserSealClient>[0]
}): Promise<ContentSidecarRequestEntry[]> {
  const { sealClient, threshold } = createBrowserSealClient(args.suiClient)
  return buildContentSidecarsForVersions({
    ...args,
    sealClient,
    threshold,
  })
}
