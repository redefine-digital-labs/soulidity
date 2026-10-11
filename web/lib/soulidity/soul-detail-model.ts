import {
  downloadPolicyFromU8, inferPersonaKind, KIND_AUDIO, KIND_SPRITE,
  type SealEnvelopeSidecar, type SoulDownloadPolicy, type SoulGrantScope, type SoulGrantStatus,
  type SoulProvenanceKind, type SoulPublicSnapshot, type SoulDetailStateSnapshot, type SoulPublicListingSnapshot,
} from '@soulidity/sdk'
import { contentEnvelopeKey, decodeContentEnvelope } from './content-envelope'
import { soulArtworkUrl } from '@/lib/animacraft/artwork-url'

/** View data is a bounded chain observation, never transaction authorization.
 * Do not cast this to the retired SQL DTO: the chain has no row timestamps,
 * member UUIDs, grant history, or paid-entry purchase amount/creation time. */
export interface ChainSoulContentVersion {
  id: string; soulOnChainId: string; contentOnChainId: string
  kind: number; kindName: string; name: string; versionIndex: string; blobObjectId: string
  readModeMask: number; opMask: number; grantScopeMask: number; isPublic: boolean; sealEncrypted: boolean
  downloadPolicy: SoulDownloadPolicy; sealSidecar: SealEnvelopeSidecar | null
  envelopeStatus: 'VERIFIED' | 'MISSING'; deleted: boolean; purged: boolean
  createdAtMs: string; createdAt: string | null
}
export interface ChainSoulGrant {
  id: string; onChainId: string; soulOnChainId: string; issuedByAddress: string | null
  granteeAddress: string; scopes: SoulGrantScope[]; scopeMask: number; status: SoulGrantStatus
  expiresAtMs: string | null; expiresAt: string | null; ownershipEpochSnapshot: string
}
export interface ChainSoulPaidConfig {
  id: string; soulOnChainId: string; paidAccessListOnChainId: string; kind: number; version: string
  priceAtomic: string; scopeMask: number; durationMs: string | null; ownershipEpochSnapshot: string; currentEpoch: boolean
}
export interface ChainSoulPaidEntry {
  id: string; soulOnChainId: string; paidAccessListOnChainId: string; buyerAddress: string; kind: number; version: string
  scopeMask: number; expiresAtMs: string | null; ownershipEpochSnapshot: string
  currentEpoch: boolean; unexpiredAtObservation: boolean
}
export interface ChainSoulDetail {
  originalPackageId: string; viewerAddress: string | null
  onChainId: string; stateOnChainId: string; contentOnChainId: string; paidAccessListOnChainId: string
  stateVersion: string; stateDigest: string; observedAtMs: string
  name: string; description: string; imageUrl: string; provenanceKind: SoulProvenanceKind
  personaKind: ReturnType<typeof inferPersonaKind>; originRef: string | null; tags: string[]; previewImages: string[]
  creatorAddress: string; creatorRoyaltyBps: number; sourceRoyaltyBps: number | null
  currentOwnerAddress: string; currentKioskId: string; currentKioskCapOnChainId: string | null
  currentOwnershipEpoch: string; grantCapacity: string; activeGrantCount: string
  createdAtMs: string; createdAt: string | null
  activeSpriteName: string | null; activeSpriteVersionIndex: string | null; activeSpriteDownloadPolicy: SoulDownloadPolicy | null
  activeVoiceName: string | null; activeVoiceVersionIndex: string | null; activeVoiceDownloadPolicy: SoulDownloadPolicy | null
  spriteConfigJson: string | null; voiceConfigJson: string | null
  collectionOnChainId: string | null
  collection: null | {
    onChainId: string; rightOnChainId: string; name: string; description: string; imageUrl: string
    creatorAddress: string; currentHolderAddress: string; currentHolderKioskId: string
    extraRoyaltyBps: number; tradeable: boolean; floorPriceAtomic: string | null; belowFloor: boolean | null
    maxSoulSupply: string | null; currentSoulSupply: string
  }
  listingObjectOnChainId: string | null; listedPriceAtomic: string | null
  /** floor-violation is app policy, not a claim that Move delisted this asset. */
  listingStatus: 'listed' | 'floor-violation' | 'unlisted'
  chainListingStatus: 'HELD' | 'LISTED'
  purchaseAvailable: boolean
  quote: null | {
    model: 'BASE_PLUS_FEES' | 'GROSS_INCLUSIVE'; platformFeeAtomic: string; priceAtomic: string
    creatorRoyaltyAtomic: string; collectionRoyaltyAtomic: string; makerSourceRoyaltyAtomic: string; totalAtomic: string
    soulCreatorRoyaltyBps: number; makerRoyaltyBps: number | null
  }
  platformFeeBps: number; market: SoulPublicListingSnapshot['market']
  activeGrants: ChainSoulGrant[]; contentVersions: ChainSoulContentVersion[]
  paidAccessKindConfigs: ChainSoulPaidConfig[]; paidAccessEntries: ChainSoulPaidEntry[]
  paidEntriesScope: SoulDetailStateSnapshot['paidEntriesScope']
  isOwner: boolean; isCreator: boolean; isGrantedAgent: boolean
  unavailable: SoulDetailStateSnapshot['unavailable']
  notAuthorization: true
}

/** Date is a presentation format, not a u64 container. Retain the exact ms even
 * when it cannot be represented by JS Date; never round or invent an ISO date. */
export function chainDateIso(milliseconds: string): string | null {
  if (!/^(0|[1-9][0-9]*)$/.test(milliseconds)) throw new Error('SOUL_DETAIL_DATE_INVALID')
  const ms = BigInt(milliseconds)
  if (ms > 18446744073709551615n) throw new Error('SOUL_DETAIL_DATE_INVALID')
  return ms <= 8640000000000000n ? new Date(Number(ms)).toISOString() : null
}

export function compareChainInteger(a: string, b: string) { return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0 }
export function formatChainTimestamp(milliseconds: string | null, relative = false): string {
  if (milliseconds === null) return 'Not recorded on chain'
  const iso = chainDateIso(milliseconds)
  if (iso === null) return `${milliseconds} ms (outside calendar range)`
  const then = Number(BigInt(milliseconds)), diff = Date.now() - then
  if (!relative || diff < 0) return new Date(then).toLocaleString()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return new Date(then).toLocaleDateString()
}
function check(value: unknown): asserts value { if (!value) throw new Error('SOUL_DETAIL_SNAPSHOT_MISMATCH') }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function scopes(mask: string): SoulGrantScope[] {
  const n = BigInt(mask)
  check(n > 0n && n <= 15n)
  return (['seal', 'memory', 'skills', 'assets'] as const).filter((_, bit) => (n & (1n << BigInt(bit))) !== 0n)
}

/** Inputs must come from the actual verified readers. Identity checks here
 * catch accidental cross-request joins, not replace their raw BCS proofs. */
export function composeChainSoulDetail(input: {
  originalPackageId: string; asset: SoulPublicSnapshot; state: SoulDetailStateSnapshot
  listing: SoulPublicListingSnapshot; currentKioskCapId: string | null; viewerAddress: string | null
}): ChainSoulDetail {
  const { asset: a, state: s, listing: l, viewerAddress, currentKioskCapId, originalPackageId } = structuredClone(input)
  for (const observed of [s, l]) check(observed.soulId === a.soulId && observed.stateId === a.stateId
    && observed.stateVersion === a.stateVersion && observed.stateDigest === a.stateDigest
    && observed.currentOwner === a.currentOwner && observed.creator === a.creator)
  check(s.contentId === a.contentId && s.ownershipEpoch === a.ownershipEpoch && l.kioskId === a.kioskId
    && (l.status === 'LISTED') === a.listedIndividually && (l.collection?.id ?? null) === a.collectionId
    && (currentKioskCapId === null || viewerAddress === a.currentOwner))
  const config = new Map(s.config.map(row => [row.key, row]))
  check(config.size === s.config.length)
  const contentVersions = s.contentVersions.map(({ kind, kindName, name, versionIndex, slot }): ChainSoulContentVersion => {
    const identity = { contentObjectId: s.contentId, kind, name, versionIndex, blobObjectId: slot.blob_object_id }
    const envelope = config.get(contentEnvelopeKey(identity))
    let sealSidecar: SealEnvelopeSidecar | null = null
    if (envelope) {
      check(envelope.valueUtf8 !== null)
      sealSidecar = decodeContentEnvelope(envelope.valueUtf8, identity, originalPackageId).sidecar
    }
    return { id: JSON.stringify([s.contentId, kind, name, versionIndex]), soulOnChainId: a.soulId, contentOnChainId: s.contentId,
      kind, kindName, name, versionIndex, blobObjectId: slot.blob_object_id, readModeMask: Number(slot.read_mode_mask),
      opMask: Number(slot.op_mask), grantScopeMask: Number(slot.grant_scope_mask), isPublic: slot.is_public,
      sealEncrypted: slot.seal_encrypted, downloadPolicy: downloadPolicyFromU8(slot.download_policy), sealSidecar,
      envelopeStatus: sealSidecar ? 'VERIFIED' : 'MISSING', deleted: slot.deleted, purged: slot.purged,
      createdAtMs: slot.created_at_ms, createdAt: chainDateIso(slot.created_at_ms) }
  })
  const activeGrants = s.grants.map(({ slot, currentEpoch, unexpiredAtObservation, grant }): ChainSoulGrant => ({
    id: slot.grant_id, onChainId: slot.grant_id, soulOnChainId: a.soulId, issuedByAddress: grant?.issued_by ?? null,
    granteeAddress: slot.grantee, scopes: scopes(slot.scope_mask), scopeMask: Number(slot.scope_mask),
    status: !currentEpoch ? 'invalidated' : unexpiredAtObservation ? 'active' : 'expired',
    expiresAtMs: slot.expires_at_ms, expiresAt: slot.expires_at_ms === null ? null : chainDateIso(slot.expires_at_ms),
    ownershipEpochSnapshot: slot.ownership_epoch_snapshot,
  }))
  const sprite = s.activeBindings.find(v => v.kind === KIND_SPRITE), voice = s.activeBindings.find(v => v.kind === KIND_AUDIO)
  const stringConfig = (key: string) => { const row = config.get(key); if (row) check(row.valueUtf8 !== null); return row?.valueUtf8 ?? null }
  const collection = l.collection
  return freeze({ originalPackageId, viewerAddress, onChainId: a.soulId, stateOnChainId: a.stateId, contentOnChainId: a.contentId, paidAccessListOnChainId: s.paidAccessListId,
    stateVersion: a.stateVersion, stateDigest: a.stateDigest, observedAtMs: s.observedAtMs,
    name: a.name, description: a.description, imageUrl: soulArtworkUrl(a.imageUrl, a.soulId), provenanceKind: (['native', 'imported', 'personal-join', 'animacraft'] as const)[a.provenanceKind],
    personaKind: inferPersonaKind([...a.publicPreview.tags]), originRef: a.originRef, tags: [...a.publicPreview.tags], previewImages: [...a.publicPreview.previewImages],
    creatorAddress: a.creator, creatorRoyaltyBps: a.creatorRoyaltyBps, sourceRoyaltyBps: l.sourceRoyaltyBps,
    currentOwnerAddress: a.currentOwner, currentKioskId: a.kioskId, currentKioskCapOnChainId: currentKioskCapId,
    currentOwnershipEpoch: s.ownershipEpoch, grantCapacity: s.grantCapacity, activeGrantCount: s.activeGrantCount,
    createdAtMs: a.createdAtMs, createdAt: chainDateIso(a.createdAtMs),
    activeSpriteName: sprite?.name ?? null, activeSpriteVersionIndex: sprite?.version_index ?? null,
    activeSpriteDownloadPolicy: sprite ? downloadPolicyFromU8(sprite.download_policy) : null,
    activeVoiceName: voice?.name ?? null, activeVoiceVersionIndex: voice?.version_index ?? null,
    activeVoiceDownloadPolicy: voice ? downloadPolicyFromU8(voice.download_policy) : null,
    spriteConfigJson: stringConfig('sprite_config_json'), voiceConfigJson: stringConfig('voice_config_json'),
    collectionOnChainId: a.collectionId, collection: collection ? {
      onChainId: collection.id, rightOnChainId: collection.rightId, name: collection.name, description: collection.description,
      imageUrl: collection.imageUrl, creatorAddress: collection.creator, currentHolderAddress: collection.currentHolder,
      currentHolderKioskId: collection.holderKioskId, extraRoyaltyBps: collection.extraRoyaltyBps, tradeable: collection.rightTradeable,
      floorPriceAtomic: collection.floor.floorPriceAtomic, belowFloor: collection.floor.belowFloor,
      maxSoulSupply: collection.maxSupply, currentSoulSupply: collection.currentSupply,
    } : null,
    listingObjectOnChainId: l.listingId, listedPriceAtomic: l.price, chainListingStatus: l.status,
    listingStatus: l.status === 'HELD' ? 'unlisted' : l.collection?.floor.belowFloor === true ? 'floor-violation' : 'listed',
    purchaseAvailable: l.status === 'LISTED' && l.collection?.floor.belowFloor !== true
      && l.market.secondaryEnabled && (a.provenanceKind !== 3 || l.market.nativeFeePolicyMatches === true),
    quote: l.quote && l.price !== null ? { model: l.quote.model, platformFeeAtomic: l.quote.platformFee, priceAtomic: l.price,
      creatorRoyaltyAtomic: l.quote.creatorRoyalty, collectionRoyaltyAtomic: l.quote.collectionRoyalty,
      makerSourceRoyaltyAtomic: l.quote.makerSourceRoyalty, totalAtomic: l.quote.totalPayment,
      soulCreatorRoyaltyBps: a.creatorRoyaltyBps, makerRoyaltyBps: l.sourceRoyaltyBps } : null,
    platformFeeBps: l.market.platformFeeBps, market: l.market, contentVersions, activeGrants,
    paidAccessKindConfigs: s.paidAccessKindConfigs.map(({ kind, config: c, currentEpoch }) => ({
      id: `${s.paidAccessListId}:${kind}`, soulOnChainId: a.soulId, paidAccessListOnChainId: s.paidAccessListId, kind,
      version: c.version, priceAtomic: c.price_atomic, scopeMask: Number(c.scope_mask), durationMs: c.duration_ms,
      ownershipEpochSnapshot: c.ownership_epoch_snapshot, currentEpoch,
    })),
    paidAccessEntries: s.paidAccessEntries.map(({ buyerAddress, kind, entry: e, currentEpoch, unexpiredAtObservation }) => ({
      id: `${s.paidAccessListId}:${buyerAddress}:${kind}`, soulOnChainId: a.soulId, paidAccessListOnChainId: s.paidAccessListId,
      buyerAddress, kind, version: e.version, scopeMask: Number(e.scope_mask), expiresAtMs: e.expires_at_ms,
      ownershipEpochSnapshot: e.ownership_epoch_snapshot, currentEpoch, unexpiredAtObservation,
    })),
    paidEntriesScope: s.paidEntriesScope, isOwner: viewerAddress === a.currentOwner, isCreator: viewerAddress === a.creator,
    isGrantedAgent: activeGrants.some(grant => grant.granteeAddress === viewerAddress && grant.status === 'active'),
    unavailable: s.unavailable, notAuthorization: true,
  })
}
