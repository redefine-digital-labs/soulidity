/**
 * Soulidity Phase 2 type surface. Every legacy type that mirrored the deleted
 * Move modules (`memory.move`, `skills.move`, `assets.move`, `metadata.move`,
 * `content_access.move`, `seal_policy.move`) has been removed. All slot-level
 * content now lives in a single typed-content root (`SoulContent`) addressed by
 * `(kind, name, versionIndex)`.
 */

/**
 * Seal envelope sidecar — describes the AES-GCM encrypted DEK + content
 * binding written alongside Walrus blobs. Mirrors the layout enforced by
 * `web/lib/services/seal-crypto.ts`.
 */
export interface SealEnvelopeSidecar {
  version: 1
  mode: 'seal-envelope'
  /**
   * Immutable Seal identity namespace. This is always the first/original
   * Soulidity package, never the latest callable upgrade package.
   *
   * Optional only for compatibility with v1 sidecars written before the
   * routing split. Readers must recover the namespace from `encryptedDek`
   * and validate it before requesting Seal keys.
   */
  sealPackageId?: string
  documentId: string
  encryptedDek: string
  iv: string
  cipher: 'AES-GCM-256'
  mimeType: string
  fileName: string
  contentHash: string
}

// ── Listing / grant / provenance enums ───────────────────────────────────
export type SoulListingStatus = 'held' | 'listed' | 'floor-violation'
export type SoulGrantStatus = 'active' | 'revoked' | 'expired' | 'superseded' | 'invalidated'
export type SoulGrantScope = 'seal' | 'memory' | 'skills' | 'assets'
export type SoulProvenanceKind = 'native' | 'imported' | 'personal-join' | 'animacraft'

/**
 * Per-slot download policy. Mirrors `content.move::DOWNLOAD_POLICY_*`.
 * `public` means the slot blob may be served plaintext (caller still needs
 * `READ_PUBLIC` in the slot's `read_mode_mask`); `owner_only` and `allowlist`
 * require Seal session keys.
 */
export type SoulDownloadPolicy = 'public' | 'owner_only' | 'allowlist'

/**
 * Persona kind label kept on `SoulAsset.persona_kind`. Mirror of an off-chain
 * facet only — the protocol itself does not distinguish "characters" vs
 * "trainers". Used by the marketplace for filtering.
 */
export type SoulPersonaKind = 'characters' | 'trainers'

// ── Content slot read-mode helpers ───────────────────────────────────────
export type ContentReadMode = 'owner' | 'grant' | 'paid' | 'public'

/**
 * Resolved access channel for a single content version. Computed server-side
 * after authn/authz checks and before issuing the Seal session payload.
 */
export type ContentAccessKind = 'owner' | 'granted-agent' | 'paid' | 'public'

// ── On-chain object projections (read-only mirrors) ──────────────────────
export interface SoulidityMarketConfig {
  objectId: string
  packageId: string
  feeRecipient: string
  platformFeeBps: number
  paused: boolean
}

export interface SoulidityMarketConfigV2 {
  objectId: string
  packageId: string
  legacyConfigId: string
  feeRecipient: string
  platformFeeBps: number
  primaryEnabled: boolean
  secondaryEnabled: boolean
}

/** Isolated secondary-market policy introduced by Soulidity v6. */
export interface SoulidityMarketConfigV6 {
  objectId: string
  packageId: string
  configV2Id: string
  legacyConfigId: string
  feeRecipient: string
  platformFeeBps: number
  secondaryEnabled: boolean
}

export interface SoulObject {
  objectId: string
  packageId: string
  creatorAddress: string
  name: string
  description: string
  imageUrl: string
  provenanceKind: SoulProvenanceKind
  originRef: string | null
}

export interface ActiveGrantSlotObject {
  grantId: string
  granteeAddress: string
  scopeMask: number
  scopes: SoulGrantScope[]
  expiresAtMs: number | null
  ownershipEpochSnapshot: number | null
}

/**
 * Phase 2: `SoulState` no longer references `metadata_id` / `skills_id` /
 * `assets_id` / `memory_id`. The single typed-content root is `content_id`,
 * and `access_list_id` now points at the per-Soul `SoulPaidAccessList`.
 */
export interface SoulStateObject {
  objectId: string
  packageId: string
  soulId: string
  creatorAddress: string
  creatorRoyaltyBps: number
  currentOwnerAddress: string
  currentKioskId: string
  ownershipEpoch: number
  grantCapacity: number
  activeGrantCount: number
  activeGrants: ActiveGrantSlotObject[]
  activeGrantsTableId?: string | null
  contentId: string | null
  paidAccessListId: string | null
  collectionId: string | null
  isListed: boolean
  /** SoulAppearanceStateV6 bound through the SoulState dynamic-field key u8=3. */
  animacraftAppearanceV6Id: string | null
  /** SoulWardrobeV7 bound through the SoulState dynamic-field key u8=4. */
  animacraftWardrobeV7Id: string | null
  /** Trusted MakerPhysicalProfileV7 marker at SoulState key u8=7. */
  animacraftPhysicalProfileV7Id: string | null
}

/**
 * Immutable cross-package receipt created when Soulidity consumes Animacraft's
 * version-matched authorization. v4 uses `CanonicalSoulMintAuthorization`;
 * commerce v5 wraps it in `CommerceV5SoulMintAuthorization` together with the
 * authenticated MakerRoot creator royalty. v5 purchases pay the source share
 * directly to the original `makerCreatorAddress` frozen in this receipt.
 */
export interface AnimacraftProvenanceObject {
  objectId: string
  packageId: string
  soulId: string
  animacraftVersion: number
  makerId: string
  makerTreasuryId: string
  makerCreatorAddress: string
  payerAddress: string
  profileJsonBlobId: string
  imageBlobId: string
  imageUrl: string
  makerRoyaltyBps: number
  mintPaymentCoinType: string
  mintPriceAtomic: string
  protocolFeeConfigId: string
  protocolTreasuryId: string
  primaryProtocolFeeBps: number
  primaryProtocolFeeAtomic: string
  authorizedAtMs: string
}

/**
 * Active-binding mirror for a kind that supports `OP_ACTIVE_BIND` (sprite,
 * audio, custom). Snapshot of `SoulContent.active_table[kind]`.
 */
export interface SoulContentActiveBinding {
  kind: number
  name: string
  versionIndex: number
  downloadPolicy: SoulDownloadPolicy
}

/**
 * Read-only projection of the single typed-content root attached to a Soul.
 */
export interface SoulContentObject {
  objectId: string
  packageId: string
  soulId: string
  versionCount: number
  /** Active bindings keyed by kind id. Only kinds with `has_active_binding=true` appear. */
  activeBindings: SoulContentActiveBinding[]
}

export interface SoulListingObject {
  objectId: string
  packageId: string
  /** 1/2 use the additive legacy/v2 quote; 5 uses the Animacraft gross-price path. */
  version: number
  soulId: string
  stateId: string
  sellerAddress: string
  sellerKioskId: string
  priceAtomic: bigint
  creatorAddress: string
  creatorRoyaltyBps: number
  collectionId: string | null
  active: boolean
}

export interface SoulCollectionObject {
  objectId: string
  packageId: string
  creatorAddress: string
  extraRoyaltyBps: number
  tradeable: boolean
  currentHolderAddress: string
  currentHolderKioskId: string
  rightId: string
  // null = unlimited; bigint reflects on-chain Option<u64> exactly.
  maxSupply: bigint | null
  currentSupply: bigint
}

export interface SoulCollectionRightObject {
  objectId: string
  packageId: string
  collectionId: string
  creatorAddress: string
  name: string
  description: string
  imageUrl: string
}

export interface CollectionListingObject {
  objectId: string
  packageId: string
  collectionId: string
  rightId: string
  sellerAddress: string
  sellerKioskId: string
  priceAtomic: bigint
  active: boolean
}

export interface SoulGrantObject {
  objectId: string
  packageId: string
  soulId: string
  granteeAddress: string
  issuedByAddress: string
  ownershipEpochSnapshot: number
  scopeMask: number
  scopes: SoulGrantScope[]
  expiresAtMs: number | null
}

/**
 * Read-only projection of `SoulPaidAccessList` (per-Soul, 1:1).
 */
export interface SoulPaidAccessListObject {
  objectId: string
  packageId: string
  soulId: string
  creatorAddress: string
  /** kind id → KindPaidConfig snapshot. */
  kindConfigs: SoulPaidAccessKindConfigSnapshot[]
}

export interface SoulPaidAccessKindConfigSnapshot {
  kind: number
  version: number
  priceAtomic: bigint
  scopeMask: number
  durationMs: bigint | null
  ownershipEpochSnapshot: number
}

export interface SoulPaidAccessKindEntrySnapshot {
  kind: number
  version: number
  scopeMask: number
  expiresAtMs: bigint | null
  ownershipEpochSnapshot: number
}

// ── DB-mirror shapes (Prisma row → API JSON) ─────────────────────────────
export interface SoulContentVersionRecord {
  id: string
  soulOnChainId: string
  contentOnChainId: string
  kind: number
  kindName: string
  name: string
  versionIndex: number
  blobObjectId: string
  blobId: string | null
  readModeMask: number
  opMask: number
  grantScopeMask: number
  isPublic: boolean
  sealEncrypted: boolean
  downloadPolicy: SoulDownloadPolicy
  sealSidecar: SealEnvelopeSidecar | null
  deletedAt: string | null
  purgedAt: string | null
  createdAtMs: number
  createdAt: string
  updatedAt: string
}

export interface SoulContentVersionsResponse {
  soulOnChainId: string
  contentOnChainId: string | null
  kind: number
  name: string
  items: SoulContentVersionRecord[]
  nextCursor: string | null
  total: number
}

export interface SoulPaidAccessKindConfigRecord {
  id: string
  soulOnChainId: string
  paidAccessListOnChainId: string
  kind: number
  version: number
  priceAtomic: string
  scopeMask: number
  durationMs: string | null
  ownershipEpochSnapshot: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SoulPaidAccessEntryRecord {
  id: string
  soulOnChainId: string
  paidAccessListOnChainId: string
  buyerAddress: string
  kind: number
  version: number
  scopeMask: number
  pricePaidAtomic: string
  expiresAtMs: string | null
  ownershipEpochSnapshot: number
  revokedAt: string | null
  createdAtMs: number
  createdAt: string
  updatedAt: string
}

export interface SoulQuoteBreakdown {
  platformFeeAtomic: string
  priceAtomic: string
  creatorRoyaltyAtomic: string
  collectionRoyaltyAtomic: string
  totalAtomic: string
  /** Present for Animacraft-derived Souls; mirrors creatorRoyaltyAtomic for compatibility. */
  makerRoyaltyAtomic?: string
  makerRoyaltyBps?: number
  /** Present for Animacraft v5 gross-price listings; frozen at canonical mint. */
  soulCreatorRoyaltyBps?: number
  royaltySource?: 'soul-creator' | 'animacraft-maker'
}

/**
 * Unified Soul row mirror. The active sprite/voice fields cache a subset of
 * `SoulContent.active_table` for fast persona rendering — they MUST be kept
 * in sync via `ActiveBindingUpdated` event handlers, not consulted directly
 * for authorization. Any access decision must read the canonical slot
 * `(kind, name, versionIndex)` from `soul_content_version_records`.
 */
export interface SoulAssetSummary {
  id: string
  onChainId: string
  stateOnChainId: string
  /** Mirror of `SoulState.content_id` — the typed-content root object id. */
  contentOnChainId: string | null
  /** Mirror of `SoulState.access_list_id` — the per-Soul SoulPaidAccessList. */
  paidAccessListOnChainId: string | null
  name: string
  description: string
  imageUrl: string
  /** Cached active-sprite binding from `SoulContent.active_table[KIND_SPRITE]`. */
  activeSpriteName: string | null
  activeSpriteVersionIndex: number | null
  activeSpriteDownloadPolicy: SoulDownloadPolicy | null
  /** Cached active-voice binding from `SoulContent.active_table[KIND_AUDIO]`. */
  activeVoiceName: string | null
  activeVoiceVersionIndex: number | null
  activeVoiceDownloadPolicy: SoulDownloadPolicy | null
  /** Cached `SoulState.config_ext['sprite_config_json']`. */
  spriteConfigJson: string | null
  voiceConfigJson: string | null
  provenanceKind: SoulProvenanceKind
  personaKind: SoulPersonaKind
  originRef: string | null
  tags: string[]
  previewImages: string[]
  creatorAddress: string
  creatorRoyaltyBps: number
  currentOwnerAddress: string
  currentKioskId: string
  currentKioskCapOnChainId: string
  listingObjectOnChainId: string | null
  listedPriceAtomic: string | null
  listingStatus: SoulListingStatus
  collectionOnChainId: string | null
  grantCapacity: number
  activeGrantCount: number
  createdAt: string
  updatedAt: string
}

export interface SoulGrantRecord {
  id: string
  onChainId: string
  soulOnChainId: string
  issuedByAddress: string
  issuedByMemberId: string | null
  granteeAddress: string
  granteeMemberId: string | null
  scopes: SoulGrantScope[]
  status: SoulGrantStatus
  expiresAt: string | null
  endedAt: string | null
  replacedByGrantOnChainId: string | null
  createdAt: string
  updatedAt: string
}

export interface SoulCollectionAssetSummary {
  id: string
  onChainId: string
  rightOnChainId: string
  creatorAddress: string
  creatorMemberId: string | null
  currentHolderAddress: string
  currentHolderMemberId: string | null
  currentHolderKioskId: string
  name: string
  description: string
  imageUrl: string
  extraRoyaltyBps: number
  floorPriceAtomic: string | null
  tradeable: boolean
  listingObjectOnChainId: string | null
  listedPriceAtomic: string | null
  listingStatus: SoulListingStatus
  // soulCount mirrors SoulCollection.current_supply 1:1; kept as alias for
  // legacy callers. New code should read currentSoulSupply.
  soulCount: number
  currentSoulSupply: number
  // null = unlimited supply. Atomic string to avoid bigint-in-JSON.
  maxSoulSupply: string | null
  createdAt: string
  updatedAt: string
}

export interface SoulCollectionAssetDetail extends SoulCollectionAssetSummary {
  souls: SoulAssetSummary[]
}

export interface CollectionDetailStats {
  soulFloorAtomic: string | null
  soulHolders: number
  soulVolume: string | null
}

export interface CollectionDetailResponse extends SoulCollectionAssetDetail {
  quote: {
    priceAtomic: string
    platformFeeAtomic: string
    totalAtomic: string
  } | null
  isHolder: boolean
  isCreator: boolean
  stats: CollectionDetailStats
}

export interface SoulAssetDetail extends SoulAssetSummary {
  creatorMemberId: string | null
  currentOwnerMemberId: string | null
  /** Live `SoulState.ownership_epoch`; paid access with a different snapshot is stale. */
  currentOwnershipEpoch: number | null
  readme: string | null
  collection: SoulCollectionAssetSummary | null
  activeGrants: SoulGrantRecord[]
  /**
   * Subset of `soul_content_version_records` rows attached to this Soul
   * (typically: SOUL_DOC v0, latest MEMORY versions, latest SKILL versions
   * per name, active SPRITE / AUDIO versions). Full lists are paginated via
   * `/api/souls/[id]/content` endpoints.
   */
  contentVersions: SoulContentVersionRecord[]
  paidAccessKindConfigs: SoulPaidAccessKindConfigRecord[]
  paidAccessEntries: SoulPaidAccessEntryRecord[]
  isOwner: boolean
  isCreator: boolean
  isGrantedAgent: boolean
  quote: SoulQuoteBreakdown | null
  platformFeeBps: number | null
  animacraftProvenance: AnimacraftProvenanceObject | null
}

export interface SoulsListResponse {
  items: SoulAssetSummary[]
  total: number
  page: number
  totalPages: number
}

export interface CollectionsListResponse {
  items: SoulCollectionAssetSummary[]
  total: number
  page: number
  totalPages: number
}

export interface MySoulActiveGrant {
  granteeAddress: string
  createdAt: string
}

export interface MySoulEntry extends SoulAssetSummary {
  collectionName: string | null
  activeGrantDetails: MySoulActiveGrant[]
}

export interface SoulPurchaseActivity {
  id: string
  txDigest: string
  soulOnChainId: string
  soulName: string | null
  paidAtomic: string | null
  totalAtomic: string | null
  createdAt: string
}

export interface MySoulsResponse {
  owned: MySoulEntry[]
  collections: SoulCollectionAssetSummary[]
  purchases: SoulPurchaseActivity[]
  grants: SoulGrantRecord[]
}

// ── Access-resolution responses ──────────────────────────────────────────
//
// Phase 2 collapses the old per-kind access response shapes (`SoulAccessResponse`,
// `SkillAccessResponse`, `AssetAccessResponse`, `MemoryAccessResponse`) into a
// single `ContentAccessResponse`. The protocol entry the caller invokes is
// always `content::seal_approve_content_*` (or `paid_access::seal_approve_content_paid_access`).
export type ContentAccessResponse =
  | {
      visibility: 'public-plaintext'
      slot: ContentSlotDescriptor
      artifact: {
        walrusBlobUrl: string | null
        walrusBlobId: string | null
        blobObjectId: string
      }
    }
  | {
      visibility: 'sealed'
      slot: ContentSlotDescriptor
      artifact: {
        walrusBlobUrl: string | null
        walrusBlobId: string | null
        blobObjectId: string
      }
      accessPolicy: {
        /** @deprecated Namespace alias kept for older clients. */
        packageId: string
        /** First/original package used by Seal encryption and SessionKey. */
        sealPackageId: string
        /** Latest package used only as the `seal_approve*` Move call target. */
        callablePackageId: string
        stateObjectId: string
        contentObjectId: string
        kind: number
        name: string
        versionIndex: number
        moduleName: 'content' | 'paid_access'
        functionName:
          | 'seal_approve_content_owner'
          | 'seal_approve_content_granted_agent'
          | 'seal_approve_content_paid_access'
          | 'seal_approve_content_public'
        soulGrantObjectId: string | null
        paidAccessListOnChainId: string | null
        documentIdHex: string
      }
      seal: {
        network: 'testnet' | 'mainnet'
        threshold: number
        verifyKeyServers: boolean
        serverConfigs: Array<{
          objectId: string
          weight: number
          aggregatorUrl?: string
        }>
      }
      sealSidecar: SealEnvelopeSidecar
      viewerAddress: string
      accessKind: ContentAccessKind
      sessionTtlMin: number
    }

export interface ContentSlotDescriptor {
  kind: number
  kindName: string
  name: string
  versionIndex: number
  readModeMask: number
  opMask: number
  grantScopeMask: number
  isPublic: boolean
  sealEncrypted: boolean
  downloadPolicy: SoulDownloadPolicy
  deletedAt: string | null
  purgedAt: string | null
}

// ── Personal kiosk / mint plumbing ───────────────────────────────────────
export interface ResolvedPersonalKiosk {
  ownerAddress: string
  currentKioskId: string
  currentKioskCapOnChainId: string
}

export type ResolvePersonalKioskResult =
  | { status: 'ready'; kiosk: ResolvedPersonalKiosk }
  | { status: 'missing' }

/**
 * Sync payload for the publish/import/personal-join routes after a successful
 * mint TX. `contentOnChainId` is required; `paidAccessListOnChainId` is the
 * shared SoulPaidAccessList created at mint time.
 */
export interface SoulMintSyncPayload {
  txDigest: string
  soulOnChainId: string
  stateOnChainId: string
  contentOnChainId: string
  paidAccessListOnChainId: string
}
