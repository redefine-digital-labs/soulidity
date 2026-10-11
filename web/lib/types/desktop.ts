import type { ContentAccessResponse, SoulListingStatus } from '@soulidity/sdk'

export type DesktopCatalogSourceType = 'starter' | 'soul'
export type DesktopSpriteDownloadPolicy = 'public' | 'owner_only' | 'allowlist' | 'missing' | 'invalid'

export interface DesktopSpriteSheetConfig {
  src: string
  frameWidth: number
  frameHeight: number
  columns: number
  animations: Record<string, {
    frames: number[]
    fps: number
    loop: boolean
  }>
}

export interface DesktopSpriteManifest {
  assetName: string | null
  versionIndex: number | null
  fileName: string
  configFileName: string
  downloadPolicy: DesktopSpriteDownloadPolicy
  config: DesktopSpriteSheetConfig | null
  publicUrl?: string | null
  /** Sealed Seal-session payload when the active sprite/voice is access-gated. */
  privateAccess?: Extract<ContentAccessResponse, { visibility: 'sealed' }> | null
  /** Phase 2: typed-content root id replaces the legacy SoulMetadata object id. */
  contentOnChainId?: string | null
  error?: string | null
}

/**
 * UI marker for an asset-scope `SoulGrant` that authorises the calling
 * desktop pet's agent address to download protected sprites of this Soul.
 * Computed by `/api/desktop/me/souls` against the pet bearer token; null
 * everywhere else (public catalog, browser cookie path).
 *
 * The marker is presentation-only — `/api/desktop/catalog/[id]` still
 * verifies access through `resolveContentAccessPayload` against live
 * on-chain grant slots before issuing Seal session parameters.
 */
export interface DesktopAgentSpriteGrant {
  active: boolean
  grantOnChainId: string
  expiresAt: string | null
}

export interface DesktopCatalogItem {
  id: string
  sourceType: DesktopCatalogSourceType
  sourceRef: string
  title: string
  description: string | null
  coverImage: string
  thumbnail: string
  listingStatus: SoulListingStatus | null
  listedPriceAtomic: string | null
  spriteDownloadPolicy: DesktopSpriteDownloadPolicy
  /**
   * Phase 2: live `SoulContent.active_table[KIND_SPRITE]` projection from
   * the mirror. Reflects on-chain `OP_ACTIVE_BIND` updates so consumers can
   * detect when their cached sprite version drifts from the active one.
   */
  activeSpriteName?: string | null
  activeSpriteVersionIndex?: number | null
  activeSpriteDownloadPolicy?: DesktopSpriteDownloadPolicy | null
  /** Set on My Souls items when the desktop pet has an active asset-scope
   *  grant. Marketplace items always leave this undefined. */
  agentSpriteGrant?: DesktopAgentSpriteGrant | null
  updatedAt: string
}

export interface DesktopPersonaManifestFile {
  path: string
  url: string
  checksum: string
}

export interface DesktopPersonaManifest extends DesktopCatalogItem {
  version: string
  checksum: string
  files: DesktopPersonaManifestFile[]
  sprite: DesktopSpriteManifest | null
  /** Soul route ID for access APIs (= onChainId for soul entries) */
  routeId?: string
  /** On-chain soul ID */
  onChainId?: string
  /** direct = public file URLs (starter), authenticated = needs desktop token (soul) */
  downloadMode?: 'direct' | 'authenticated'
}

/**
 * `DesktopCatalogItem` extended with explicit owned-souls fields. Returned
 * by `/api/desktop/me/souls` so the renderer can pre-decide whether a
 * protected download is currently authorised for the desktop pet.
 */
export interface DesktopMySoulsItem extends DesktopCatalogItem {
  agentSpriteGrant: DesktopAgentSpriteGrant | null
}

export interface DesktopDeviceStartRequest {
  agentAddress: string
  nonce: string
  signature: string
}

export interface DesktopDeviceStartResponse {
  deviceCode: string
  userCode: string
  expiresAt: string
  pollInterval: number
}

export type DesktopDevicePollResponse =
  | {
      status: 'pending'
      expiresAt: string
      pollInterval: number
    }
  | {
      status: 'confirmed'
      accountId: string
      deepLink: string | null
      desktopAccessToken?: string
      agentApiKey?: string
      expiresAt: string
      pollInterval: number
    }
  | {
      status: 'expired'
      expiresAt: string
      pollInterval: number
    }
  | {
      status: 'invalid_code'
      expiresAt: null
      pollInterval: number
    }

export interface DesktopDeviceCompleteResponse {
  status: 'confirmed'
  accountId: string
  deviceCode: string
  userCode: string
  deepLink: string | null
  expiresAt: string
  confirmedAt: string
  pollInterval: number
  /**
   * Browser-safe pet identifier — populated whenever the linked session has
   * a desktop pet (i.e. the device-start flow carried an `agentAddress`).
   * Used by the post-link auto-authorize UX to immediately fetch the
   * grantable-souls list without a second round-trip. NEVER includes
   * `desktopAccessToken` or `agentApiKey`; those remain on the desktop poll
   * response only.
   */
  petId?: string | null
  agentAddress?: string | null
}

/**
 * Combined view returned by `GET /api/desktop/me`. Most fields originate from
 * the account-level `DesktopProfile` row (`accountId`, `preferences`,
 * `updatedAt`), but `agentAddress`, `activeSourceType`, `activeSourceRef`,
 * and `lastSyncedAt` are sourced from the caller's `DesktopPet` row
 * (per-pet, resolved via the `dtk_*` desktop access token). The
 * `DesktopProfile` row no longer stores those fields.
 */
export interface DesktopProfile {
  accountId: string
  agentAddress: string | null
  primarySuiAddress: string | null
  activeSourceType: DesktopCatalogSourceType | null
  activeSourceRef: string | null
  preferences: Record<string, unknown> | null
  lastSyncedAt: string | null
  updatedAt: string
}

export interface DesktopMeResponse {
  profile: DesktopProfile
  activePersona: DesktopPersonaManifest | null
}
