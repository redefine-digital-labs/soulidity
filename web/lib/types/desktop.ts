export type DesktopCatalogSourceType = 'starter' | 'soul'

export interface DesktopCatalogItem {
  id: string
  sourceType: DesktopCatalogSourceType
  sourceRef: string
  title: string
  description: string | null
  coverImage: string
  thumbnail: string
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

export interface DesktopProfile {
  accountId: string
  activeSourceType: DesktopCatalogSourceType | null
  activeSourceRef: string | null
  preferences: Record<string, unknown> | null
  lastSyncedAt: string | null
  updatedAt: string
}
