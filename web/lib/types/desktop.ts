import type { ContentAccessResponse, SoulListingStatus } from '@/lib/soulidity/types'

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
  desktopAccessToken?: string
  expiresAt: string
  confirmedAt: string
  pollInterval: number
}

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
